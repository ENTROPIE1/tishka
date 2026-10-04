import type { ListenResult } from '../../voice/listen';
import { createVad, type Vad } from '../../voice/vad';
import { encodeWav, resample } from '../../voice/wav';

const PROCESSOR_BUFFER = 4096;
const TARGET_RATE = 16000;

export interface RecorderOptions {
  onLevel(level: number): void;
  onResult(result: ListenResult): void;
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  makeVad?: () => Vad;
  targetRate?: number;
}

export interface Recorder {
  start(): Promise<boolean>;
  stop(): void;
  cancel(): void;
}

// Запись фразы: микрофон → кадры в VAD → WAV 16 кГц для главного процесса.
export function createRecorder(options: RecorderOptions): Recorder {
  const getUserMedia =
    options.getUserMedia ?? ((constraints: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(constraints));
  const makeVad = options.makeVad ?? (() => createVad());
  const targetRate = options.targetRate ?? TARGET_RATE;

  let stream: MediaStream | undefined;
  let context: AudioContext | undefined;
  let processor: ScriptProcessorNode | undefined;
  let vad: Vad | undefined;
  let chunks: Float32Array[] = [];
  let sourceRate = targetRate;
  let active = false;

  function cleanup(): void {
    active = false;
    if (processor !== undefined) {
      processor.onaudioprocess = null;
      processor.disconnect();
      processor = undefined;
    }
    if (context !== undefined) {
      void context.close().catch(() => undefined);
      context = undefined;
    }
    if (stream !== undefined) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      stream = undefined;
    }
    vad = undefined;
  }

  function reset(): void {
    chunks = [];
    options.onLevel(0);
  }

  function finalize(): void {
    const collected = chunks;
    const rate = sourceRate;
    cleanup();
    reset();
    if (collected.length === 0) {
      options.onResult({ kind: 'nospeech' });
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
    const resampled = resample(merged, rate, targetRate);
    options.onResult({ kind: 'wav', data: encodeWav(resampled, targetRate) });
  }

  function cancel(): void {
    if (!active) {
      return;
    }
    cleanup();
    reset();
    options.onResult({ kind: 'cancel' });
  }

  function stop(): void {
    if (!active) {
      return;
    }
    finalize();
  }

  async function start(): Promise<boolean> {
    if (active) {
      return true;
    }
    try {
      stream = await getUserMedia({ audio: true });
    } catch {
      options.onResult({ kind: 'error', message: 'Нет доступа к микрофону' });
      return false;
    }
    context = new AudioContext();
    sourceRate = context.sampleRate;
    vad = makeVad();
    reset();

    const source = context.createMediaStreamSource(stream);
    processor = context.createScriptProcessor(PROCESSOR_BUFFER, 1, 1);
    processor.onaudioprocess = (event) => {
      if (!active || vad === undefined) {
        return;
      }
      const input = event.inputBuffer.getChannelData(0);
      const frame = new Float32Array(input);
      chunks.push(frame);
      const verdict = vad.push(frame, (frame.length / sourceRate) * 1000);
      options.onLevel(vad.level());
      if (verdict === 'end' || verdict === 'timeout') {
        finalize();
      } else if (verdict === 'nospeech') {
        cleanup();
        reset();
        options.onResult({ kind: 'nospeech' });
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

  return { start, stop, cancel };
}
