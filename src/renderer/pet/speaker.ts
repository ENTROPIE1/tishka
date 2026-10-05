import { envelope } from '../../voice/envelope';
import { visemeAt, type MoodTimeMark, type MouthTrack } from '../../voice/lipsync';
import type { SpeakMessage } from '../../voice/speech-queue';
import { timingMark } from '../shared/timing';

const WINDOW_MS = 50;
const TICK_MS = 33;
const SMOOTHING = 0.4;

export interface SpeakerDeps {
  setMouth(level: number): void;
  // Рот по дорожке форм и смена эмоции: у персонажа без них — прежний режим.
  setViseme?(shape: string | null): void;
  setMood?(name: string): void;
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
  let track: MouthTrack | undefined;
  let moodMarks: MoodTimeMark[] | undefined;
  let appliedMoods = 0;

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
    track = undefined;
    moodMarks = undefined;
    appliedMoods = 0;
    deps.setMouth(0);
    deps.setViseme?.(null);
  }

  // Эмоции применяются по времени звука, последняя остаётся до смены состояния.
  function applyMoods(elapsedMs: number): void {
    if (moodMarks === undefined) {
      return;
    }
    while (appliedMoods < moodMarks.length && moodMarks[appliedMoods].at * 1000 <= elapsedMs) {
      deps.setMood?.(moodMarks[appliedMoods].mood);
      appliedMoods += 1;
    }
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
    timingMark('speak.play.end');
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
        track = message.mouth;
        moodMarks = message.moods;
        appliedMoods = 0;
        // Настроение ответа задаёт эмоцию в начале звука, метки меняют дальше.
        deps.setMood?.(message.mood ?? 'neutral');
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
          applyMoods(elapsed);
          if (track !== undefined && deps.setViseme !== undefined) {
            deps.setViseme(visemeAt(track, elapsed / 1000));
            return;
          }
          const index = Math.floor(elapsed / WINDOW_MS);
          const target = index >= 0 && index < values.length ? values[index] : 0;
          lastLevel += (target - lastLevel) * SMOOTHING;
          deps.setMouth(lastLevel);
        }, TICK_MS);
        applyMoods(0);
        node.start();
        timingMark('speak.play.start');
      })
      .catch(() => {
        if (current === generation) {
          complete();
        }
      });
  }

  return { play, stop };
}
