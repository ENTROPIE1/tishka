export type VadVerdict = 'continue' | 'end' | 'timeout' | 'nospeech';

export interface VadOptions {
  silenceMs?: number;      // тишина после речи, завершающая фразу
  maxMs?: number;          // максимальная длительность записи
  minSpeechMs?: number;    // минимальная длинная речь, чтобы щелчок не считался
  noSpeechMs?: number;     // предел ожидания речи; <= 0 — не ограничивать
}

export interface Vad {
  push(frame: Float32Array, frameMs: number): VadVerdict;
  level(): number;         // 0..1, для индикатора
}

const CALIBRATION_MS = 300;
const NOSPEECH_MS = 5000;

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

export function createVad(options: VadOptions = {}): Vad {
  const silenceMs = options.silenceMs ?? 1200;
  const maxMs = options.maxMs ?? 15000;
  const minSpeechMs = options.minSpeechMs ?? 200;
  const noSpeechMs = options.noSpeechMs ?? NOSPEECH_MS;

  let elapsed = 0;
  let noiseSum = 0;
  let noiseCount = 0;
  let noise = 0;
  let loudRun = 0;
  let silenceRun = 0;
  let speechStarted = false;
  let lastLevel = 0;
  let done = false;

  function threshold(): number {
    return noise <= 0 ? 0.01 : noise * 2 + 0.01;
  }

  function push(frame: Float32Array, frameMs: number): VadVerdict {
    if (done) {
      return 'continue';
    }
    const value = rms(frame);
    lastLevel = value;

    if (elapsed < CALIBRATION_MS) {
      noiseSum += value;
      noiseCount += 1;
      noise = noiseSum / noiseCount;
    } else if (value > threshold()) {
      loudRun += frameMs;
      silenceRun = 0;
      if (!speechStarted && loudRun >= minSpeechMs) {
        speechStarted = true;
      }
    } else {
      loudRun = 0;
      if (speechStarted) {
        silenceRun += frameMs;
      }
    }

    elapsed += frameMs;

    if (speechStarted && silenceRun >= silenceMs) {
      done = true;
      return 'end';
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
    level(): number {
      return Math.max(0, Math.min(1, lastLevel * 4));
    }
  };
}
