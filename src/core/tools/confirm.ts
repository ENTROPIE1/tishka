import type { EventBus } from '../types';
import { confirmQuestion, describeAction } from './confirm-description';

// Ошибки, которые получает модель по итогу вопроса.
export const CONFIRM_DENIED_ERROR = 'Человек не подтвердил';
export const CONFIRM_BACKGROUND_ERROR = 'Нужно подтверждение, выполните навык вручную';
export const CONFIRM_TIMEOUT_MS = 120_000;

export interface ConfirmInput {
  connection: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface ConfirmGate {
  // Спрашивает человека и ждёт ответа: true — «да», false — «нет», остановка или время.
  request(input: ConfirmInput): Promise<boolean>;
  answer(id: string, decision: boolean): boolean;   // false — вопрос уже закрыт
  answerPending(decision: boolean): boolean;        // ответ на открытый вопрос
  cancelAll(): void;                                // «стоп», новая реплика: отказ
  pending(): boolean;
}

interface Pending {
  resolve(decision: boolean): void;
  timer: ReturnType<typeof setTimeout>;
}

export function createConfirmGate(bus: EventBus, timeoutMs = CONFIRM_TIMEOUT_MS): ConfirmGate {
  const pending = new Map<string, Pending>();
  let counter = 0;

  function close(id: string, decision: boolean): boolean {
    const entry = pending.get(id);
    if (entry === undefined) {
      return false;
    }
    pending.delete(id);
    clearTimeout(entry.timer);
    bus.emit({ type: 'confirm.close', id });
    entry.resolve(decision);
    return true;
  }

  function firstId(): string | undefined {
    return pending.keys().next().value;
  }

  return {
    request(input: ConfirmInput): Promise<boolean> {
      counter += 1;
      const id = `confirm-${counter}`;
      const action = describeAction(input.tool, input.args);
      const text = confirmQuestion(action, input.connection);
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          close(id, false);
        }, timeoutMs);
        pending.set(id, { resolve, timer });
        bus.emit({
          type: 'confirm.request',
          id,
          connection: input.connection,
          tool: input.tool,
          action,
          text
        });
      });
    },
    answer: (id, decision) => close(id, decision),
    answerPending(decision: boolean): boolean {
      const id = firstId();
      return id === undefined ? false : close(id, decision);
    },
    cancelAll(): void {
      for (const id of [...pending.keys()]) {
        close(id, false);
      }
    },
    pending: () => pending.size > 0
  };
}
