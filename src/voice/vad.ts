import { createSpeechStart } from './speech-start';

export type VadVerdict = 'continue' | 'end' | 'timeout' | 'nospeech';

export interface VadOptions {
  silenceMs?: number;      // тишина после речи, завершающая фразу
  maxMs?: number;          // максимальная длительность записи
  minSpeechMs?: number;    // сколько громких кадров в окне нужно для начала речи
  noSpeechMs?: number;     // предел ожидания речи; <= 0 — не ограничивать
  leadMs?: number;         // запас до начала речи в результате
  tailMs?: number;         // запас после конца речи в результате
  continuous?: boolean;    // фраза за фразой без пересоздания
  settleMs?: number;       // первые кадры не считаются речью (щелчок включения)
  threshold?: number;      // порог речи; не задан — значение по умолчанию
}

export interface Vad {
  push(frame: Float32Array, frameMs: number): VadVerdict;
  level(): number;         // 0..1 относительно порога (порог — 0.5)
  heardSpeech(): boolean;
  reset(): void;           // сброс текущей фразы
  // bufferStartMs — время начала переданного буфера на общей шкале VAD;
  // нужно, когда буфер собран заново и его края не совпадают с началом записи.
  result(samples: Float32Array, sampleRate: number, bufferStartMs?: number): Float32Array;
}

// Порог для тихой комнаты, пока калибровка и ручная настройка не заданы.
export const DEFAULT_MIC_THRESHOLD = 0.004;

const DEFAULT_MIN_SPEECH_MS = 200;
const DEFAULT_LEAD_MS = 300;
const DEFAULT_TAIL_MS = 200;
const NOSPEECH_MS = 5000;
const LEVEL_EPSILON = 1e-6;

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
  // Порог фиксированный: звук тише порога — тишина, громче — речь.
  const threshold = options.threshold ?? DEFAULT_MIC_THRESHOLD;

  let elapsed = 0;
  let lastLevel = 0;
  let speechStarted = false;
  let speechStartMs = 0;
  let lastLoudMs = 0;
  let silenceRun = 0;
  let done = false;
  const speech = createSpeechStart(minSpeechMs);

  function resetPhrase(): void {
    speechStarted = false;
    speechStartMs = 0;
    lastLoudMs = 0;
    silenceRun = 0;
    speech.reset();
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

    // Кадры после включения микрофона идут только в оценку шума.
    const settling = elapsed < settleMs;
    const loud = !settling && value - threshold > LEVEL_EPSILON;
    if (loud) {
      lastLoudMs = elapsed + frameMs;
    }
    if (!speechStarted && speech.push(loud, frameMs, elapsed)) {
      speechStarted = true;
      speechStartMs = speech.startMs();
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
    reset: resetPhrase,
    level(): number {
      return Math.max(0, Math.min(1, lastLevel / (2 * threshold)));
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
