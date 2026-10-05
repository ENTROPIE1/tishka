import type { InputSource, Reply } from './types';

export type TurnRunner = (text: string, signal: AbortSignal, source: InputSource) => Promise<Reply>;

export interface TurnQueueDeps {
  run: TurnRunner;
  reset(): void;   // очистка контекста агента между ходами
  onReplaced?(): void;   // ждущая реплика вытеснена новой
}

// Реплика заменена ждущей в очереди: вызов завершается без ответа по существу.
export const REPLACED_REPLY: Reply = { say: 'Отвечу на новый вопрос' };
export const CANCELLED_REPLY: Reply = { say: 'Остановлено' };
// Служебная строка о вытесненной реплике: в ленте чата приглушённо, ёж её не
// озвучивает, в историю как ответ она не пишется.
export const REPLACED_NOTE = 'Не отвечал: пришёл новый вопрос';

interface Running {
  text: string;
  source: InputSource;
  controller: AbortController;
  promise: Promise<Reply>;
}

interface Waiting {
  text: string;
  source: InputSource;
  promise: Promise<Reply>;
  resolve(reply: Reply): void;
}

export interface TurnQueue {
  push(text: string, source?: InputSource): Promise<Reply>;
  cancel(): boolean;               // true — отменён выполняющийся ход или очищена очередь
  busy(): boolean;
  resetBetweenTurns(): void;
}

// Ходы выполняются по одному. Одинаковая реплика, которая уже выполняется или
// ждёт, второй раз не ставится; в очереди ждёт не больше одной реплики, новая
// её заменяет. Отмена прерывает выполняющийся ход и очищает очередь.
export function createTurnQueue(deps: TurnQueueDeps): TurnQueue {
  let running: Running | undefined;
  let waiting: Waiting | undefined;
  let resetPending = false;

  function settle(): void {
    if (resetPending) {
      resetPending = false;
      deps.reset();
    }
    const next = waiting;
    waiting = undefined;
    if (next !== undefined) {
      start(next.text, next.source, next.resolve);
    }
  }

  function start(text: string, source: InputSource, resolve: (reply: Reply) => void): Promise<Reply> {
    const controller = new AbortController();
    const promise = deps.run(text, controller.signal, source);
    running = { text, source, controller, promise };
    void promise
      .catch(() => CANCELLED_REPLY)
      .then((reply) => {
        if (running?.controller === controller) {
          running = undefined;
        }
        resolve(reply);
        settle();
      });
    return promise;
  }

  function push(text: string, source: InputSource = 'text'): Promise<Reply> {
    if (running === undefined) {
      return start(text, source, () => undefined);
    }
    if (running.text === text) {
      return running.promise;
    }
    if (waiting?.text === text) {
      return waiting.promise;
    }
    if (waiting !== undefined) {
      waiting.resolve(REPLACED_REPLY);
      deps.onReplaced?.();
    }
    let resolve!: (reply: Reply) => void;
    const promise = new Promise<Reply>((res) => {
      resolve = res;
    });
    waiting = { text, source, promise, resolve };
    return promise;
  }

  function cancel(): boolean {
    let stopped = false;
    if (waiting !== undefined) {
      waiting.resolve(CANCELLED_REPLY);
      waiting = undefined;
      stopped = true;
    }
    if (running !== undefined) {
      running.controller.abort();
      stopped = true;
    }
    return stopped;
  }

  return {
    push,
    cancel,
    busy: () => running !== undefined,
    resetBetweenTurns: () => {
      resetPending = true;
    }
  };
}
