import { createVad, type VadSensitivity } from '../../voice/vad';
import { createRecorder } from './recorder';

export interface MicCheckResult {
  heard: boolean;
  wav?: Uint8Array;
  error?: string;
}

export interface MicCheckHandles {
  onProgress(level: number, heard: boolean): void;
  onDone(result: MicCheckResult): void;
}

export interface MicCheckOptions {
  durationMs?: number;
  sensitivity?: VadSensitivity;
}

export interface MicCheck {
  start(): void;
  stop(): void;
}

const DEFAULT_DURATION_MS = 5000;
const SPEECH_LEVEL = 0.5;

// Проверка микрофона: запись заданной длительности с показом уровня; в конце
// возвращает WAV, чтобы вызывающий показал распознанный текст.
export function createMicCheck(handles: MicCheckHandles, options: MicCheckOptions = {}): MicCheck {
  const durationMs = options.durationMs ?? DEFAULT_DURATION_MS;
  const sensitivity = options.sensitivity ?? 'normal';
  let heard = false;

  const recorder = createRecorder({
    sensitivity,
    onLevel(level): void {
      if (level >= SPEECH_LEVEL) {
        heard = true;
      }
      handles.onProgress(level, heard);
    },
    onResult(result): void {
      if (result.kind === 'wav') {
        handles.onDone({ heard, wav: result.data });
      } else if (result.kind === 'error') {
        handles.onDone({ heard, error: result.message });
      } else if (result.kind === 'nospeech') {
        handles.onDone({ heard: false });
      }
    },
    makeVad: () =>
      createVad({
        sensitivity,
        maxMs: durationMs,
        noSpeechMs: 0,
        silenceMs: durationMs + 60000
      })
  });

  return {
    start(): void {
      heard = false;
      handles.onProgress(0, false);
      void recorder.start();
    },
    stop(): void {
      recorder.cancel();
    }
  };
}
