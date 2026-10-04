import { createEventBus } from '../core/events';
import type { EventBus, TishkaEvent } from '../core/types';
import type { TalkSource } from '../pet/state';

// Шина событий с пометкой источника обращения: пока ядро обрабатывает реплику
// из чата или от ежа, события несут этот источник (см. pet-window, pet/state).
export interface SourceBus extends EventBus {
  source(): TalkSource;
  run<T>(source: TalkSource, task: () => Promise<T>): Promise<T>;
  // Событие от имени источника: во время обработки слушатели видят этот
  // источник, а не текущее значение шины (озвучка реплики из чата).
  emitAs(source: TalkSource, event: TishkaEvent): void;
}

export function createSourceBus(inner: EventBus = createEventBus()): SourceBus {
  let current: TalkSource = 'pet';
  // Обращения обрабатываются по очереди, чтобы источник не перебивался.
  let chain: Promise<unknown> = Promise.resolve();

  function run<T>(source: TalkSource, task: () => Promise<T>): Promise<T> {
    const next = chain.then(async () => {
      current = source;
      try {
        return await task();
      } finally {
        current = 'pet';
      }
    });
    chain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  return {
    emit: (event: TishkaEvent): void => {
      inner.emit(event);
    },
    on: (listener) => inner.on(listener),
    source: () => current,
    run,
    emitAs: (source: TalkSource, event: TishkaEvent): void => {
      const saved = current;
      current = source;
      try {
        inner.emit(event);
      } finally {
        current = saved;
      }
    }
  };
}
