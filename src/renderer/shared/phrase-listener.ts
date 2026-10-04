import { createVad, type Vad, type VadSensitivity } from '../../voice/vad';
import { encodeWav, normalizePeak, resample } from '../../voice/wav';
import { createMicCapture, type MicCapture } from './mic-capture';
import { timingMark } from './timing';

const TARGET_RATE = 16000;
const DEFAULT_SILENCE_MS = 800;
const DEFAULT_MAX_PHRASE_MS = 12000;
const PRE_ROLL_MS = 500;
const SETTLE_MS = 300;
const MIN_PHRASE_MS = 400;

export interface PhraseListenerOptions {
  onPhrase(wav: Uint8Array): void;
  onLevel?(level: number): void;
  onError?(message: string): void;
  sensitivity?: VadSensitivity;
  threshold?: number;
  silenceMs?: number;
  maxPhraseMs?: number;
  capture?: MicCapture;
}

export interface PhraseListener {
  start(): Promise<boolean>;
  stop(): void;
  pause?(active: boolean): void;
}

interface PreRollFrame {
  data: Float32Array;
  startMs: number;
  ms: number;
}

// Постоянное прослушивание для режима разговора: микрофон открыт, речь режется
// на фразы. Пока речь не началась, звук не копится — держим только скользящий
// запас последних 500 мс, чтобы не обрезать первое слово.
export function createPhraseListener(options: PhraseListenerOptions): PhraseListener {
  const silenceMs = options.silenceMs ?? DEFAULT_SILENCE_MS;
  const maxPhraseMs = options.maxPhraseMs ?? DEFAULT_MAX_PHRASE_MS;
  const capture = options.capture ?? createMicCapture();

  let active = false;
  let runId = 0;
  let vad: Vad | undefined;
  let sourceRate = TARGET_RATE;
  let nowMs = 0;
  let preRoll: PreRollFrame[] = [];
  let preRollMs = 0;
  let capturing = false;
  let phraseFrames: Float32Array[] = [];
  let phraseStartMs = 0;
  let paused = false;

  function makeVad(): Vad {
    return createVad({
      silenceMs,
      maxMs: maxPhraseMs,
      noSpeechMs: 0,
      sensitivity: options.sensitivity,
      threshold: options.threshold,
      continuous: true,
      settleMs: SETTLE_MS
    });
  }

  function emitPhrase(activeVad: Vad): void {
    const collected = phraseFrames;
    const startMs = phraseStartMs;
    phraseFrames = [];
    capturing = false;
    if (collected.length === 0) {
      return;
    }
    let total = 0;
    for (const part of collected) {
      total += part.length;
    }
    if (total === 0) {
      return;
    }
    const merged = new Float32Array(total);
    let offset = 0;
    for (const part of collected) {
      merged.set(part, offset);
      offset += part.length;
    }
    if (!activeVad.heardSpeech()) {
      return;
    }
    const trimmed = activeVad.result(merged, sourceRate, startMs);
    if (trimmed.length === 0 || (trimmed.length / sourceRate) * 1000 < MIN_PHRASE_MS) {
      return;
    }
    const normalized = normalizePeak(trimmed);
    const wav = encodeWav(resample(normalized, sourceRate, TARGET_RATE), TARGET_RATE);
    timingMark('phrase.end', { ms: Math.round((trimmed.length / sourceRate) * 1000), bytes: wav.length });
    options.onPhrase(wav);
  }

  function handleFrame(frame: Float32Array, sampleRate: number): void {
    if (!active || vad === undefined || paused) {
      return;
    }
    sourceRate = sampleRate;
    const frameMs = (frame.length / sampleRate) * 1000;
    const frameStartMs = nowMs;
    const verdict = vad.push(frame, frameMs);
    options.onLevel?.(vad.level());

    if (!capturing) {
      preRoll.push({ data: frame, startMs: frameStartMs, ms: frameMs });
      preRollMs += frameMs;
      while (preRollMs > PRE_ROLL_MS && preRoll.length > 0) {
        const oldest = preRoll.shift();
        if (oldest !== undefined) {
          preRollMs -= oldest.ms;
        }
      }
      if (vad.heardSpeech()) {
        capturing = true;
        timingMark('speech.detected');
        timingMark('phrase.start');
        phraseFrames = preRoll.map((item) => item.data);
        phraseStartMs = preRoll.length > 0 ? preRoll[0].startMs : frameStartMs;
        preRoll = [];
        preRollMs = 0;
      }
    } else {
      phraseFrames.push(frame);
    }
    nowMs += frameMs;

    if (capturing && (verdict === 'end' || verdict === 'timeout')) {
      emitPhrase(vad);
    }
  }

  async function start(): Promise<boolean> {
    if (active) {
      return true;
    }
    const id = (runId += 1);
    const ok = await capture.start(handleFrame);
    if (id !== runId) {
      return false;
    }
    if (!ok) {
      options.onError?.('Не слышу микрофон');
      return false;
    }
    nowMs = 0;
    preRoll = [];
    preRollMs = 0;
    capturing = false;
    phraseFrames = [];
    vad = makeVad();
    active = true;
    timingMark('listen.start');
    return true;
  }

  function stop(): void {
    runId += 1;
    active = false;
    vad = undefined;
    preRoll = [];
    preRollMs = 0;
    capturing = false;
    phraseFrames = [];
    capture.stop();
  }

  // Идущая запись отбрасывается без распознавания: при паузе сбрасываем и
  // накопленные кадры, и состояние детектора речи. Микрофон при этом открыт.
  function pause(value: boolean): void {
    if (paused === value) {
      return;
    }
    paused = value;
    if (value) {
      capturing = false;
      phraseFrames = [];
      preRoll = [];
      preRollMs = 0;
      if (active) {
        vad = makeVad();
      }
    }
  }

  return { start, stop, pause };
}
