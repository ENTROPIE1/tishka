import type { TalkSource } from '../pet/state';

export interface SpeechItem {
  text: string;
  wav: Uint8Array;
  source?: TalkSource;   // источник реплики: сопровождает и её озвучку
}

export interface SpeakMessage {
  wav: Uint8Array;
  volume: number;
  id?: number;
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
