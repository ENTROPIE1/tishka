import type { EventBus } from '../core/types';
import type { TimingMark } from '../main/timing-log';
import type { TranscribeResult } from './stt-service';
import { matchWake } from './wake';
import { wavDurationSec } from './wav';

// Эпоха разговора: номер, который меняется при каждом включении и выключении.
interface Epoch {
  now(): number;
  next(): void;
}

function createEpoch(): Epoch {
  let epoch = 0;
  return {
    now: () => epoch,
    next: () => {
      epoch += 1;
    }
  };
}

export interface PhraseQueueDeps {
  // Фраза уходит на распознавание: разговор включён или слушается имя,
  // и человек в этот момент не получает ответ.
  accept(): boolean;
  transcribe(wav: Uint8Array): Promise<TranscribeResult>;
  // Распознанный текст; stale — сказан при другом состоянии разговора;
  // startedAt — время начала фразы для правила времени; speechMs — длительность
  // звука фразы (для отличия настоящего промаха от короткого шума).
  onResult(result: TranscribeResult, stale: boolean, startedAt: number, speechMs: number): void;
  // Журнал времени: пока идёт распознавание, прежний ожидающий отрезок отброшен.
  mark?: TimingMark;
}

export interface PhraseQueue {
  add(wav: Uint8Array, startedAt: number): void;
  // Разговор включён: ждущая фраза отбрасывается, идущее распознавание устарело.
  conversationEnabled(): void;
  // Разговор выключен: идущее распознавание устарело.
  conversationDisabled(): void;
  // Ждущая фраза отбрасывается: прослушивание остановлено.
  dropPending(): void;
}

// Очередь распознавания: одна фраза в работе, из ожидающих хранится только самый
// свежий — прежний отбрасывается, чтобы при медленной службе не копился хвост.
// Фраза запоминает эпоху разговора на момент, когда её услышали, поэтому её
// текст помечается устаревшим, если за время распознавания разговор переключили.
export function createPhraseQueue(deps: PhraseQueueDeps): PhraseQueue {
  let recognizing = false;
  let pending: { wav: Uint8Array; epoch: number; startedAt: number } | undefined;
  const epoch = createEpoch();

  function run(item: { wav: Uint8Array; epoch: number; startedAt: number }): void {
    recognizing = true;
    void deps
      .transcribe(item.wav)
      .then((result) => {
        deps.onResult(result, item.epoch !== epoch.now(), item.startedAt, wavDurationSec(item.wav) * 1000);
      })
      .finally(() => {
        recognizing = false;
        const next = pending;
        pending = undefined;
        // Очередь проверяется заново: за время распознавания состояние могло
        // измениться, и сказанное раньше ждать больше не должно.
        if (next !== undefined && deps.accept()) {
          run(next);
        }
      });
  }

  return {
    add(wav: Uint8Array, startedAt: number): void {
      if (!deps.accept()) {
        return;
      }
      if (recognizing) {
        // Очередь не копится: свежий отрезок вытесняет прежний ожидающий.
        if (pending !== undefined) {
          deps.mark?.('stt.drop', { reason: 'busy' });
        }
        pending = { wav, epoch: epoch.now(), startedAt };
        return;
      }
      run({ wav, epoch: epoch.now(), startedAt });
    },
    conversationEnabled(): void {
      pending = undefined;
      epoch.next();
    },
    conversationDisabled(): void {
      epoch.next();
    },
    dropPending(): void {
      pending = undefined;
    }
  };
}

export interface StaleTextDeps {
  bus: EventBus;
  wakeWords(): string[];
  inConversation(): boolean;
  // Обращение без просьбы: показать запись и слушать дальше.
  startListen(): void;
}

// Сказанное при другом состоянии разговора: проверяется только на имя.
// Репликой разговора такой текст не становится и в ядро не уходит; если в нём
// есть имя, работает как обычное обращение без просьбы.
export function routeStaleText(deps: StaleTextDeps, text: string): void {
  if (!matchWake(text, deps.wakeWords()).matched) {
    return;
  }
  deps.bus.emit({ type: 'wake', source: 'name' });
  if (!deps.inConversation()) {
    deps.startListen();
  }
}
