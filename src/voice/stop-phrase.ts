import type { EventBus } from '../core/types';
import { isStopPhrase } from './wake';

// Подпись под ежом после остановки голосом.
export const STOP_CAPTION = 'остановил';

// Тишка занят: думает, работает или говорит. Речь кончается событием speak.end,
// работа ходом ядра — простоем.
const BUSY_START = new Set(['think.start', 'tool.start', 'speak.start']);
const BUSY_END = new Set(['idle', 'speak.end']);

export interface StopPhraseDeps {
  bus: EventBus;
  wakeWords(): string[];
  cancel(): void;                 // прервать текущую работу
  stopSpeech(): void;             // остановить текущую речь
  caption(text: string): void;    // разовая подпись под ежом
}

export interface StopPhrase {
  // Фраза при занятом Тишке: «стоп» останавливает работу и речь, остальные
  // фразы в ядро не уходят. false — Тишка свободен, фраза идёт своим чередом.
  phrase(text: string): boolean;
  dispose(): void;
}

// Слова остановки голосом: пока Тишка занят, короткое «стоп» (с именем или без)
// останавливает работу и речь, не уходя в ядро как реплика. Ёж показывает
// подписью «остановил» и остаётся слушать. Вне работы те же слова — реплика.
export function createStopPhrase(deps: StopPhraseDeps): StopPhrase {
  let busy = false;
  const unsubscribe = deps.bus.on((event) => {
    if (BUSY_START.has(event.type)) {
      busy = true;
    } else if (BUSY_END.has(event.type)) {
      busy = false;
    }
  });
  return {
    phrase(text: string): boolean {
      if (!busy) {
        return false;
      }
      if (isStopPhrase(text, deps.wakeWords())) {
        deps.cancel();
        deps.stopSpeech();
        deps.caption(STOP_CAPTION);
      }
      return true;
    },
    dispose: unsubscribe
  };
}
