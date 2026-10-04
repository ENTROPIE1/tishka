export type VadVerdict = 'continue' | 'end' | 'timeout' | 'nospeech';

export type VadSensitivity = 'low' | 'normal' | 'high';

export interface VadOptions {
  silenceMs?: number;      // тишина после речи, завершающая фразу
  maxMs?: number;          // максимальная длительность записи
  minSpeechMs?: number;    // сколько громких кадров в окне нужно для начала речи
  noSpeechMs?: number;     // предел ожидания речи; <= 0 — не ограничивать
  sensitivity?: VadSensitivity;
  leadMs?: number;         // запас до начала речи в результате
  tailMs?: number;         // запас после конца речи в результате
  continuous?: boolean;    // фраза за фразой без пересоздания, шум не сбрасывается
  settleMs?: number;       // первые кадры только в оценку шума (щелчок включения)
  threshold?: number;      // калиброванный порог речи; с ним sensitivity не применяется
}

export interface Vad {
  push(frame: Float32Array, frameMs: number): VadVerdict;
  level(): number;         // 0..1 относительно порога (порог — 0.5)
  heardSpeech(): boolean;
  // bufferStartMs — время начала переданного буфера на общей шкале VAD;
  // нужно, когда буфер собран заново и его края не совпадают с началом записи.
  result(samples: Float32Array, sampleRate: number, bufferStartMs?: number): Float32Array;
}

const NOISE_WINDOW_MS = 2000;
const NOISE_PERCENTILE = 0.1;
const NOISE_MIN_FRAMES = 5;
const INITIAL_NOISE = 0.002;
const SPEECH_WINDOW_MS = 400;
const DEFAULT_MIN_SPEECH_MS = 150;
const DEFAULT_LEAD_MS = 300;
const DEFAULT_TAIL_MS = 200;
const NOSPEECH_MS = 5000;
const LEVEL_EPSILON = 1e-6;

interface SensitivityConfig {
  k: number;
  floor: number;
}

const SENSITIVITY: Record<VadSensitivity, SensitivityConfig> = {
  low: { k: 3.5, floor: 0.008 },
  normal: { k: 2.5, floor: 0.004 },
  high: { k: 1.8, floor: 0.002 }
};
function rms(frame: Float32Array): number {
  if (frame.length === 0) {
    return 0;
  }
  let sum = 0;
  for (let i = 0; i < frame.length; i += 1) {
    sum += frame[i] * frame[i];
  }
  return Math.sqrt(sum / frame.length);
}
// Обрезка длинной тишины: запас до начала речи и небольшой хвост после конца.
export function trimSpeech(
  samples: Float32Array,
  sampleRate: number,
  startMs: number,
  endMs: number,
  leadMs = DEFAULT_LEAD_MS,
  tailMs = DEFAULT_TAIL_MS
): Float32Array {
  const from = Math.max(0, Math.floor(((startMs - leadMs) / 1000) * sampleRate));
  const to = Math.min(samples.length, Math.ceil(((endMs + tailMs) / 1000) * sampleRate));
  if (to <= from) {
    return samples.slice();
  }
  return samples.slice(from, to);
}
export function createVad(options: VadOptions = {}): Vad {
  const silenceMs = options.silenceMs ?? 1200;
  const maxMs = options.maxMs ?? 15000;
  const minSpeechMs = options.minSpeechMs ?? DEFAULT_MIN_SPEECH_MS;
  const noSpeechMs = options.noSpeechMs ?? NOSPEECH_MS;
  const leadMs = options.leadMs ?? DEFAULT_LEAD_MS;
  const tailMs = options.tailMs ?? DEFAULT_TAIL_MS;
  const continuous = options.continuous ?? false;
  const settleMs = options.settleMs ?? 0;
  const limits = SENSITIVITY[options.sensitivity ?? 'normal'];

  let elapsed = 0;
  let lastLevel = 0;
  let speechStarted = false;
  let speechStartMs = 0;
  let lastLoudMs = 0;
  let silenceRun = 0;
  let done = false;
  const levels: Array<{ at: number; value: number }> = [];
  const loudMarks: number[] = [];

  function noise(): number {
    if (levels.length < NOISE_MIN_FRAMES) {
      return INITIAL_NOISE;
    }
    const sorted = levels.map((item) => item.value).sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.floor(sorted.length * NOISE_PERCENTILE));
    return sorted[index];
  }

  // Калиброванный порог не опускается ниже текущего шума с запасом.
  function threshold(): number {
    if (options.threshold !== undefined) {
      return Math.max(options.threshold, noise() * 1.5);
    }
    return Math.max(noise() * limits.k, limits.floor);
  }

  // Новая фраза: оценка шума (levels) сохраняется — иначе первые кадры фразы
  // снова окажутся без данных о шуме.
  function resetPhrase(): void {
    speechStarted = false;
    speechStartMs = 0;
    lastLoudMs = 0;
    silenceRun = 0;
    loudMarks.length = 0;
    done = false;
  }

  function push(frame: Float32Array, frameMs: number): VadVerdict {
    if (done) {
      if (!continuous) {
        return 'continue';
      }
      resetPhrase();
    }
    const value = rms(frame);
    lastLevel = value;
    levels.push({ at: elapsed, value });
    while (levels.length > 0 && elapsed - levels[0].at > NOISE_WINDOW_MS) {
      levels.shift();
    }

    // Кадры после включения микрофона идут только в оценку шума.
    const settling = elapsed < settleMs;
    const loud = !settling && value - threshold() > LEVEL_EPSILON;
    if (loud) {
      loudMarks.push(elapsed);
      lastLoudMs = elapsed + frameMs;
    }
    while (loudMarks.length > 0 && loudMarks[0] <= elapsed - SPEECH_WINDOW_MS) {
      loudMarks.shift();
    }
    if (!speechStarted && loudMarks.length * frameMs >= minSpeechMs) {
      speechStarted = true;
      speechStartMs = loudMarks[0];
    }
    if (speechStarted) {
      silenceRun = loud ? 0 : silenceRun + frameMs;
    }

    elapsed += frameMs;

    if (speechStarted && silenceRun >= silenceMs) {
      done = true;
      return 'end';
    }
    // Предел длины фразы считается от начала речи, а не от открытия микрофона.
    if (speechStarted && elapsed - speechStartMs >= maxMs) {
      done = true;
      return 'timeout';
    }
    if (continuous) {
      return 'continue';
    }
    if (elapsed >= maxMs) {
      done = true;
      return 'timeout';
    }
    if (!speechStarted && noSpeechMs > 0 && elapsed >= noSpeechMs) {
      done = true;
      return 'nospeech';
    }
    return 'continue';
  }

  return {
    push,
    heardSpeech: () => speechStarted,
    level(): number {
      return Math.max(0, Math.min(1, lastLevel / (2 * threshold())));
    },
    result(samples: Float32Array, sampleRate: number, bufferStartMs = 0): Float32Array {
      if (!speechStarted) {
        return samples.slice();
      }
      return trimSpeech(
        samples,
        sampleRate,
        speechStartMs - bufferStartMs,
        lastLoudMs - bufferStartMs,
        leadMs,
        tailMs
      );
    }
  };
}
