import { createVad, type Vad } from '../../voice/vad';
import { encodeWav, resample } from '../../voice/wav';

const PROCESSOR_BUFFER = 4096;
const TARGET_RATE = 16000;
const SILENCE_MS = 800;
const MAX_PHRASE_MS = 12000;
const MIN_PHRASE_MS = 400;
const MIC_RETRY_MS = 30000;
const MIC_ERROR = 'Не слышу микрофон';

export interface WakeListenerDeps {
  onConversation?(on: boolean): void;
}

export interface WakeListener {
  setActive(active: boolean): void;
  dispose(): void;
}

function stopTracks(stream: MediaStream | undefined): void {
  if (stream === undefined) {
    return;
  }
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

// Постоянное прослушивание: микрофон открыт, звук режется на фразы тем же VAD.
export function createWakeListener(deps: WakeListenerDeps = {}): WakeListener {
  const level = document.getElementById('level') as HTMLElement | null;
  const levelFill = document.getElementById('level-fill') as HTMLElement | null;
  const mic = document.getElementById('mic') as HTMLElement | null;
  let active = false;
  let conversation = false;
  let soon = false;
  let stream: MediaStream | undefined;
  let context: AudioContext | undefined;
  let processor: ScriptProcessorNode | undefined;
  let vad: Vad | undefined;
  let chunks: Float32Array[] = [];
  let sourceRate = TARGET_RATE;
  let runId = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  function resetPhrase(): void {
    chunks = [];
    vad = createVad({ silenceMs: SILENCE_MS, maxMs: MAX_PHRASE_MS, noSpeechMs: 0 });
  }

  function clearRetry(): void {
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    }
  }

  // Микрофон не открылся: сообщаем один раз и пробуем снова через полминуты.
  function scheduleRetry(id: number): void {
    if (retryTimer !== undefined) {
      return;
    }
    window.tishka.pet.wakeError(MIC_ERROR);
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      if (id === runId && active && stream === undefined) {
        void open();
      }
    }, MIC_RETRY_MS);
  }

  function teardown(): void {
    clearRetry();
    if (processor !== undefined) {
      processor.onaudioprocess = null;
      processor.disconnect();
      processor = undefined;
    }
    if (context !== undefined) {
      void context.close().catch(() => undefined);
      context = undefined;
    }
    stopTracks(stream);
    stream = undefined;
    vad = undefined;
    chunks = [];
  }

  function emitPhrase(): void {
    let total = 0;
    for (const part of chunks) {
      total += part.length;
    }
    const collected = chunks;
    const rate = sourceRate;
    resetPhrase();
    if (total === 0 || (total / rate) * 1000 < MIN_PHRASE_MS) {
      return;
    }
    const merged = new Float32Array(total);
    let offset = 0;
    for (const part of collected) {
      merged.set(part, offset);
      offset += part.length;
    }
    window.tishka.pet.wakePhrase(encodeWav(resample(merged, rate, TARGET_RATE), TARGET_RATE));
  }

  async function open(): Promise<void> {
    const id = (runId += 1);
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      if (id === runId && active) {
        scheduleRetry(id);
      }
      return;
    }
    if (id !== runId || !active) {
      stopTracks(media);
      return;
    }
    clearRetry();
    stream = media;
    context = new AudioContext();
    sourceRate = context.sampleRate;
    resetPhrase();
    const source = context.createMediaStreamSource(stream);
    processor = context.createScriptProcessor(PROCESSOR_BUFFER, 1, 1);
    processor.onaudioprocess = (event) => {
      if (!active || vad === undefined) {
        return;
      }
      const frame = new Float32Array(event.inputBuffer.getChannelData(0));
      chunks.push(frame);
      const verdict = vad.push(frame, (frame.length / sourceRate) * 1000);
      if (levelFill !== null && conversation) {
        levelFill.style.width = `${Math.round(vad.level() * 100)}%`;
      }
      if (verdict === 'end' || verdict === 'timeout') {
        emitPhrase();
      } else if (verdict === 'nospeech') {
        resetPhrase();
      }
    };
    const sink = context.createGain();
    sink.gain.value = 0;
    source.connect(processor);
    processor.connect(sink);
    sink.connect(context.destination);
  }

  function applyActive(): void {
    if (active && stream === undefined) {
      void open();
    } else if (!active && stream !== undefined) {
      runId += 1;
      teardown();
    }
  }

  function applyUi(): void {
    if (level !== null) {
      level.hidden = !(active && conversation);
    }
    if (!active || !conversation) {
      if (levelFill !== null) {
        levelFill.style.width = '0%';
      }
    }
    if (mic !== null) {
      mic.classList.toggle('on', conversation);
      mic.classList.toggle('soon', active && conversation && soon);
    }
  }

  window.tishka.pet.onWakeState((state) => {
    active = state.active;
    soon = state.soon;
    if (state.conversation !== conversation) {
      conversation = state.conversation;
      deps.onConversation?.(conversation);
    }
    applyActive();
    applyUi();
  });

  return {
    setActive(value): void {
      active = value;
      applyActive();
      applyUi();
    },
    dispose(): void {
      runId += 1;
      active = false;
      teardown();
    }
  };
}
