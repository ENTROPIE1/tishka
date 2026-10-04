import type { EventBus } from './types';

// Цепочка, начатая не по просьбе человека (напоминание, расписание, наблюдение,
// обзор памяти, запуск навыка с экрана), завершается событием idle — как обычный ответ.
export async function runTriggered<T>(events: EventBus, task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } finally {
    events.emit({ type: 'idle' });
  }
}
