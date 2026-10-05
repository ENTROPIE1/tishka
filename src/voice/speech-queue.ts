import type { Mood } from '../core/types';
import type { TalkSource } from '../pet/state';
import type { MoodTimeMark, MouthTrack } from './lipsync';

export interface SpeechItem {
  text: string;
  wav: Uint8Array;
  source?: TalkSource;   // источник реплики: сопровождает и её озвучку
  mood?: Mood;           // настроение ответа в начале звука
  mouth?: MouthTrack;    // дорожка рта по времени звука
  moods?: MoodTimeMark[];   // смены эмоций по времени звука
}

export interface SpeakMessage {
  wav: Uint8Array;
  volume: number;
  id?: number;
  mood?: Mood;
  mouth?: MouthTrack;
  moods?: MoodTimeMark[];
}

export interface SpeechQueueDeps {
  play(item: SpeechItem, signal: AbortSignal): Promise<void>;
  onStart?(item: SpeechItem): void;
  onEnd?(): void;
  maxWaiting?: number;
}

export interface SpeechQueue {
  enqueue(item: SpeechItem): void;
  stop(): void;
  isSpeaking(): boolean;
}

const DEFAULT_MAX_WAITING = 2;

export function createSpeechQueue(deps: SpeechQueueDeps): SpeechQueue {
  const maxWaiting = deps.maxWaiting ?? DEFAULT_MAX_WAITING;
  const waiting: SpeechItem[] = [];
  let current: { controller: AbortController } | undefined;
  let running = false;
  let speaking = false;

  async function run(): Promise<void> {
    if (running) {
      return;
    }
    running = true;
    while (waiting.length > 0) {
      const item = waiting.shift();
      if (item === undefined) {
        break;
      }
      const controller = new AbortController();
      current = { controller };
      speaking = true;
      deps.onStart?.(item);
      try {
        await deps.play(item, controller.signal);
      } catch {
        // Ошибка воспроизведения не останавливает очередь.
      }
      if (current?.controller === controller) {
        current = undefined;
      }
      speaking = false;
      if (waiting.length === 0) {
        deps.onEnd?.();
      }
    }
    running = false;
    if (waiting.length > 0) {
      void run();
    }
  }

  return {
    enqueue(item): void {
      waiting.push(item);
      while (waiting.length > maxWaiting) {
        waiting.shift();
      }
      void run();
    },
    stop(): void {
      waiting.length = 0;
      current?.controller.abort();
    },
    isSpeaking: () => speaking
  };
}
