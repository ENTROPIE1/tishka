import { createVad, type Vad } from '../../voice/vad';
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
  onPhrase(wav: Uint8Array, limitHit: boolean): void;
  onLevel?(level: number): void;
  onError?(message: string): void;
  threshold?: number;
  silenceMs?: number;
  maxPhraseMs?: number;
  // Прослушивание имени режет длинный звук на отрезки: предел отрезка и
  // перекрытие на стыке, чтобы имя на границе не потерялось.
  chunkMs?: number;
  chunkOverlapMs?: number;
  inConversation?: () => boolean;   // разговор включён: предел реплики прежний
  capture?: MicCapture;
}

export interface PhraseListener {
  start(): Promise<boolean>;
  pause(active: boolean): void;
  stop(): void;
}

interface CapturedFrame {
  data: Float32Array;
  startMs: number;
  ms: number;
}

// Постоянное прослушивание: микрофон открыт, речь режется на фразы. Пока речь
// не началась, звук не копится — держим только скользящий запас последних 500 мс,
// чтобы не обрезать первое слово.
export function createPhraseListener(options: PhraseListenerOptions): PhraseListener {
  const silenceMs = options.silenceMs ?? DEFAULT_SILENCE_MS;
  const maxPhraseMs = options.maxPhraseMs ?? DEFAULT_MAX_PHRASE_MS;
  const chunkMs = options.chunkMs;
  const chunkOverlapMs = options.chunkOverlapMs ?? PRE_ROLL_MS;
  const capture = options.capture ?? createMicCapture();

  let active = false;
  let paused = false;
  let runId = 0;
  let vad: Vad | undefined;
  let sourceRate = TARGET_RATE;
  let nowMs = 0;
  let preRoll: CapturedFrame[] = [];
  let preRollMs = 0;
  let capturing = false;
  let phraseFrames: CapturedFrame[] = [];
  let phraseStartMs = 0;

  function makeVad(): Vad {
    return createVad({
      silenceMs,
      // Предел реплики в отрезках считает сам слушатель: детектор не должен
      // обрывать отрезок собственным тайм-аутом.
      maxMs: chunkMs !== undefined ? Number.MAX_SAFE_INTEGER : maxPhraseMs,
      noSpeechMs: 0,
      threshold: options.threshold,
      continuous: true,
      settleMs: SETTLE_MS
    });
  }

  function merged(frames: CapturedFrame[]): Float32Array {
    let total = 0;
    for (const part of frames) {
      total += part.data.length;
    }
    const buffer = new Float32Array(total);
    let offset = 0;
    for (const part of frames) {
      buffer.set(part.data, offset);
      offset += part.data.length;
    }
    return buffer;
  }

  // Хвост записи, с которого начнётся следующий отрезок: перекрытие на стыке.
  function overlapTail(frames: CapturedFrame[]): CapturedFrame[] {
    const tail: CapturedFrame[] = [];
    let total = 0;
    for (let i = frames.length - 1; i >= 0; i -= 1) {
      const item = frames[i];
      if (tail.length > 0 && total + item.ms > chunkOverlapMs) {
        break;
      }
      total += item.ms;
      tail.unshift(item);
    }
    return tail;
  }

  function emit(activeVad: Vad, wake: boolean): void {
    const collected = phraseFrames;
    const startMs = phraseStartMs;
    const tail = wake ? overlapTail(collected) : [];
    phraseFrames = tail;
    if (wake && tail.length > 0) {
      // Следующий отрезок считается от начала перекрытия, иначе он уйдёт
      // на распознавание сразу же, кадр за кадром.
      phraseStartMs = tail[0].startMs;
    } else {
      capturing = false;
    }
    if (collected.length === 0 || !activeVad.heardSpeech()) {
      return;
    }
    const buffer = merged(collected);
    const trimmed = activeVad.result(buffer, sourceRate, startMs);
    if (trimmed.length === 0 || (trimmed.length / sourceRate) * 1000 < MIN_PHRASE_MS) {
      return;
    }
    const normalized = normalizePeak(trimmed);
    const wav = encodeWav(resample(normalized, sourceRate, TARGET_RATE), TARGET_RATE);
    timingMark('phrase.end', { ms: Math.round((trimmed.length / sourceRate) * 1000), bytes: wav.length });
    options.onPhrase(wav, wake);
  }

  function spanMs(): number {
    const last = phraseFrames[phraseFrames.length - 1];
    return last === undefined ? 0 : last.startMs + last.ms - phraseStartMs;
  }

  function handleFrame(frame: Float32Array, sampleRate: number): void {
    if (!active || paused || vad === undefined) {
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
        phraseFrames = preRoll;
        phraseStartMs = preRoll.length > 0 ? preRoll[0].startMs : frameStartMs;
        preRoll = [];
        preRollMs = 0;
      }
    } else {
      phraseFrames.push({ data: frame, startMs: frameStartMs, ms: frameMs });
    }
    nowMs += frameMs;

    if (!capturing || phraseFrames.length === 0) {
      return;
    }
    if (verdict === 'end' || verdict === 'timeout') {
      emit(vad, false);
      return;
    }
    if (chunkMs !== undefined && options.inConversation?.() !== true) {
      // Отрезок прослушивания имени: длинный звук уходит на распознавание,
      // запись продолжается следующим отрезком с перекрытием.
      if (spanMs() >= chunkMs) {
        emit(vad, true);
      }
    } else if (spanMs() >= maxPhraseMs + PRE_ROLL_MS) {
      emit(vad, false);
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
    // Действующая пауза сохраняется: запуск при паузе (например, когда
    // человек печатает) не возобновляет запись раньше срока.
    active = true;
    timingMark('listen.start');
    return true;
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
      vad?.reset();
    }
  }

  function stop(): void {
    runId += 1;
    active = false;
    paused = false;
    vad = undefined;
    preRoll = [];
    preRollMs = 0;
    capturing = false;
    phraseFrames = [];
    capture.stop();
  }

  return { start, pause, stop };
}
