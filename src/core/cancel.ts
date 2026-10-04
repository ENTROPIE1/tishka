// Отмена текущей работы: сигнал AbortController проходит в запросы к модели,
// а ожидание инструментов прерывается сразу, не дожидаясь их завершения.

export class CancelledError extends Error {
  constructor(message = 'Остановлено') {
    super(message);
    this.name = 'CancelledError';
  }
}

export function isCancelled(error: unknown, signal?: AbortSignal): boolean {
  return error instanceof CancelledError || signal?.aborted === true;
}

export function withCancel<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(new CancelledError());
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}
