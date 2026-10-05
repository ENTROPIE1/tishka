import type { TimingMark } from '../main/timing-log';
import { createBusyIntervals, type BusyIntervals } from './busy-intervals';

// Почему фраза не стала репликой разговора:
// before-conversation — началась до готовности слушать (появление, приветствие,
// включение разговора); during-answer — началась, пока Тишка думал, работал
// или говорил.
export type PhraseDropReason = 'before-conversation' | 'during-answer';

export type PhraseDecision = { kind: 'reply' } | { kind: 'drop'; reason: PhraseDropReason };

export interface PhraseClockOptions {
  mark?: TimingMark;
  now?: () => number;
  busy?: BusyIntervals;   // отрезки занятости; без него часы ведут свои
}

export interface PhraseClock {
  // Разговор включён/выключен: момент, с которого фразы принимаются репликой.
  conversationEnabled(at?: number): void;
  conversationDisabled(): void;
  // Тишка начал или закончил отвечать (думает, работает, говорит).
  busyChanged(busy: boolean, at?: number): void;
  // Решение по фразе, начавшейся в startedAt.
  decide(startedAt: number): PhraseDecision;
  // Отметка в журнале времени об отброшенной фразе.
  drop(reason: PhraseDropReason): void;
}

// Правило времени начала — в одном месте главного процесса. Репликой
// становится только фраза, начавшаяся после включения разговора и вне окна,
// когда Тишка занят (думал, работал или говорил): в это окно попадает эхо его
// собственного голоса. Запас перед речью слушатель уже вычел из времени начала,
// поэтому фраза, задевшая хвост речи Тишки, приходит раньше конца речи и
// отбрасывается. Всё, что началось до включения разговора, репликой не является.
export function createPhraseClock(options: PhraseClockOptions = {}): PhraseClock {
  const now = options.now ?? ((): number => Date.now());
  const busy = options.busy ?? createBusyIntervals({ now });
  let conversation = false;
  let conversationSince = Number.POSITIVE_INFINITY;

  return {
    conversationEnabled(at = now()): void {
      conversation = true;
      conversationSince = at;
    },
    conversationDisabled(): void {
      conversation = false;
      conversationSince = Number.POSITIVE_INFINITY;
    },
    busyChanged(next: boolean, at = now()): void {
      if (next) {
        busy.begin('work', at);
      } else {
        busy.finish(at);
      }
    },
    decide(startedAt: number): PhraseDecision {
      if (conversation && startedAt >= conversationSince) {
        // Фраза началась, пока Тишка отвечал: это его собственная речь или
        // человек говорил поверх ответа — репликой она не становится. Отрезки
        // занятости помнят и обдумывание, и речь по отдельности.
        if (busy.intersects(startedAt)) {
          return { kind: 'drop', reason: 'during-answer' };
        }
        return { kind: 'reply' };
      }
      // Сказанное до включения разговора — «до разговора», даже если речь
      // Тишки к этому времени ещё звучала.
      return { kind: 'drop', reason: 'before-conversation' };
    },
    drop(reason: PhraseDropReason): void {
      options.mark?.('phrase.dropped', { reason });
    }
  };
}
