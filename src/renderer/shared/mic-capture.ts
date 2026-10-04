const PROCESSOR_BUFFER = 1024;

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    autoGainControl: true,
    noiseSuppression: true,
    echoCancellation: true,
    channelCount: 1
  }
};

export type MicFrameHandler = (frame: Float32Array, sampleRate: number) => void;

export interface MicCapture {
  start(onFrame: MicFrameHandler): Promise<boolean>;
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

// Микрофон → кадры по 1024 отсчёта. Один кадр — одна порция для VAD.
export function createMicCapture(): MicCapture {
  let stream: MediaStream | undefined;
  let context: AudioContext | undefined;
  let processor: ScriptProcessorNode | undefined;
  let active = false;
  let runId = 0;

  function stop(): void {
    runId += 1;
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
    stopTracks(stream);
    stream = undefined;
  }

  async function start(onFrame: MicFrameHandler): Promise<boolean> {
    const id = (runId += 1);
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
    } catch {
      return false;
    }
    if (id !== runId) {
      stopTracks(media);
      return false;
    }
    stream = media;
    context = new AudioContext();
    const sourceRate = context.sampleRate;
    const source = context.createMediaStreamSource(stream);
    processor = context.createScriptProcessor(PROCESSOR_BUFFER, 1, 1);
    processor.onaudioprocess = (event) => {
      if (!active) {
        return;
      }
      onFrame(new Float32Array(event.inputBuffer.getChannelData(0)), sourceRate);
    };
    const sink = context.createGain();
    sink.gain.value = 0;
    source.connect(processor);
    processor.connect(sink);
    sink.connect(context.destination);
    active = true;
    return true;
  }

  return { start, stop };
}
