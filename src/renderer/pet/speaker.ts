import { envelope } from '../../voice/envelope';
import type { SpeakMessage } from '../../voice/speech-queue';

const WINDOW_MS = 50;
const TICK_MS = 33;
const SMOOTHING = 0.4;

export interface SpeakerDeps {
  setMouth(level: number): void;
  onDone(id?: number): void;
}

export interface Speaker {
  play(message: SpeakMessage): void;
  stop(): void;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

// Проигрывает wav через Web Audio и двигает рот по огибающей громкости.
export function createSpeaker(deps: SpeakerDeps): Speaker {
  let context: AudioContext | undefined;
  let source: AudioBufferSourceNode | undefined;
  let timer: number | undefined;
  let values: number[] = [];
  let startedAt = 0;
  let lastLevel = 0;
  let generation = 0;
  let pending = false;
  let pendingId: number | undefined;

  function clearPlayback(): void {
    if (timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
    if (source !== undefined) {
      try {
        source.onended = null;
        source.stop();
      } catch {
        // источник уже остановлен
      }
      source = undefined;
    }
    values = [];
    lastLevel = 0;
    deps.setMouth(0);
  }

  // Завершает текущее воспроизведение ровно один раз, включая ещё не начавшееся.
  function complete(): void {
    if (!pending) {
      return;
    }
    pending = false;
    const id = pendingId;
    pendingId = undefined;
    clearPlayback();
    deps.onDone(id);
  }

  function stop(): void {
    generation += 1;
    complete();
  }

  function ensureContext(): AudioContext {
    context ??= new AudioContext();
    return context;
  }

  function play(message: SpeakMessage): void {
    complete();
    generation += 1;
    const current = generation;
    pending = true;
    pendingId = message.id;
    const audio = ensureContext();
    void audio
      .resume()
      .catch(() => undefined)
      .then(() => audio.decodeAudioData(new Uint8Array(message.wav).buffer))
      .then((buffer) => {
        if (current !== generation) {
          return;
        }
        const samples = buffer.getChannelData(0);
        values = envelope(samples, buffer.sampleRate, WINDOW_MS);
        const node = audio.createBufferSource();
        node.buffer = buffer;
        const gain = audio.createGain();
        gain.gain.value = clamp01(message.volume);
        node.connect(gain).connect(audio.destination);
        source = node;
        startedAt = audio.currentTime;
        lastLevel = 0;
        node.onended = () => {
          if (current === generation) {
            complete();
          }
        };
        timer = window.setInterval(() => {
          const elapsed = (audio.currentTime - startedAt) * 1000;
          const index = Math.floor(elapsed / WINDOW_MS);
          const target = index >= 0 && index < values.length ? values[index] : 0;
          lastLevel += (target - lastLevel) * SMOOTHING;
          deps.setMouth(lastLevel);
        }, TICK_MS);
        node.start();
      })
      .catch(() => {
        if (current === generation) {
          complete();
        }
      });
  }

  return { play, stop };
}
