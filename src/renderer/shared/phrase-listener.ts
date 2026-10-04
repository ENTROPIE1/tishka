import { createVad, type Vad, type VadSensitivity } from '../../voice/vad';
import { encodeWav, normalizePeak, resample } from '../../voice/wav';

const PROCESSOR_BUFFER = 1024;
const TARGET_RATE = 16000;
const DEFAULT_SILENCE_MS = 800;
const DEFAULT_MAX_PHRASE_MS = 12000;

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    autoGainControl: true,
    noiseSuppression: true,
    echoCancellation: true,
    channelCount: 1
  }
};

export interface PhraseListenerOptions {
  onPhrase(wav: Uint8Array): void;
  onLevel?(level: number): void;
  onError?(message: string): void;
  sensitivity?: VadSensitivity;
  silenceMs?: number;
  maxPhraseMs?: number;
}

export interface PhraseListener {
  start(): Promise<boolean>;
  stop(): void;
}

function stopTracks(stream: MediaStream | undefined): void {
  if (stream === undefined) {
    return;
  }
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

// Постоянное прослушивание для режима разговора: микрофон открыт, речь режется
// на фразы тем же VAD, готовые фразы уходят наружу.
export function createPhraseListener(options: PhraseListenerOptions): PhraseListener {
  const silenceMs = options.silenceMs ?? DEFAULT_SILENCE_MS;
  const maxPhraseMs = options.maxPhraseMs ?? DEFAULT_MAX_PHRASE_MS;
  let stream: MediaStream | undefined;
  let context: AudioContext | undefined;
  let processor: ScriptProcessorNode | undefined;
  let vad: Vad | undefined;
  let chunks: Float32Array[] = [];
  let sourceRate = TARGET_RATE;
  let active = false;
  let runId = 0;

  function resetPhrase(): void {
    chunks = [];
    vad = createVad({ silenceMs, maxMs: maxPhraseMs, noSpeechMs: 0, sensitivity: options.sensitivity });
  }

  function teardown(): void {
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
    active = false;
  }

  function emitPhrase(): void {
    const collected = chunks;
    const rate = sourceRate;
    const activeVad = vad;
    resetPhrase();
    if (collected.length === 0) {
      return;
    }
    let total = 0;
    for (const part of collected) {
      total += part.length;
    }
    const merged = new Float32Array(total);
    let offset = 0;
    for (const part of collected) {
      merged.set(part, offset);
      offset += part.length;
    }
    const trimmed = activeVad === undefined ? merged : activeVad.result(merged, rate);
    const normalized = normalizePeak(trimmed);
    options.onPhrase(encodeWav(resample(normalized, rate, TARGET_RATE), TARGET_RATE));
  }

  async function start(): Promise<boolean> {
    if (active) {
      return true;
    }
    const id = (runId += 1);
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    } catch {
      options.onError?.('Не слышу микрофон');
      return false;
    }
    if (id !== runId) {
      stopTracks(media);
      return false;
    }
    stream = media;
    context = new AudioContext();
    sourceRate = context.sampleRate;
    resetPhrase();
    const source = context.createMediaStreamSource(stream);
    processor = context.createScriptProcessor(PROCESSOR_BUFFER, 1, 1);
    processor.onaudioprocess = (event) => {
      if (vad === undefined) {
        return;
      }
      const frame = new Float32Array(event.inputBuffer.getChannelData(0));
      chunks.push(frame);
      const verdict = vad.push(frame, (frame.length / sourceRate) * 1000);
      options.onLevel?.(vad.level());
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
    active = true;
    return true;
  }

  function stop(): void {
    runId += 1;
    teardown();
  }

  return { start, stop };
}
