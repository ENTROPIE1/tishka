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

function stopTracks(stream: MediaStream | undefined): void {
  if (stream === undefined) {
    return;
  }
  for (const track of stream.getTracks()) {
    track.stop();
  }
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
  let starting = false;
  let runId = 0;

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
    active = false;
    starting = false;
  }

  function reset(): void {
    chunks = [];
    options.onLevel(0);
  }

  function finalize(): void {
    const collected = chunks;
    const rate = sourceRate;
    teardown();
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

  // Повторное нажатие до фактического начала записи отменяет запуск.
  function stop(): void {
    if (starting) {
      runId += 1;
      starting = false;
      options.onResult({ kind: 'cancel' });
      return;
    }
    if (!active) {
      return;
    }
    finalize();
  }

  function cancel(): void {
    if (!starting && !active) {
      return;
    }
    runId += 1;
    teardown();
    reset();
    options.onResult({ kind: 'cancel' });
  }

  async function start(): Promise<boolean> {
    if (active || starting) {
      return true;
    }
    const id = (runId += 1);
    starting = true;
    let media: MediaStream;
    try {
      media = await getUserMedia({ audio: true });
    } catch {
      starting = false;
      options.onResult({ kind: 'error', message: 'Нет доступа к микрофону' });
      return false;
    }
    if (id !== runId) {
      stopTracks(media);
      starting = false;
      return false;
    }
    stream = media;
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
        teardown();
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
    starting = false;
    return true;
  }

  return { start, stop, cancel };
}
