export interface VoiceStatusView {
  state: string;
}

export interface VoiceReadinessOptions {
  onReady(ready: boolean): void;
  status?(): Promise<VoiceStatusView>;
}

export interface VoiceReadiness {
  dispose(): void;
}

export const READY_POLL_MS = 1500;
export const READY_POLL_LIMIT = 40;
export const RARE_POLL_MS = 10000;

// Следит за готовностью распознавания: частый опрос, затем редкий, плюс
// перепроверка при возвращении фокуса. Сбой запроса не останавливает опрос.
export function createVoiceReadiness(options: VoiceReadinessOptions): VoiceReadiness {
  const getStatus = options.status ?? (() => window.tishka.voice.status());
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let ready = false;
  let attempts = 0;
  let inFlight = false;

  function clearTimer(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  function schedule(delay: number): void {
    clearTimer();
    if (disposed || ready) {
      return;
    }
    timer = setTimeout(() => {
      timer = undefined;
      void refresh();
    }, delay);
  }

  async function refresh(): Promise<void> {
    if (disposed || inFlight) {
      return;
    }
    clearTimer();
    inFlight = true;
    let isReady = false;
    try {
      const view = await getStatus();
      isReady = view.state === 'ready';
    } catch {
      isReady = false;
    } finally {
      inFlight = false;
    }
    if (disposed) {
      return;
    }
    ready = isReady;
    options.onReady(isReady);
    if (isReady) {
      return;
    }
    attempts += 1;
    schedule(attempts <= READY_POLL_LIMIT ? READY_POLL_MS : RARE_POLL_MS);
  }

  function onFocus(): void {
    if (disposed || ready) {
      return;
    }
    void refresh();
  }

  window.addEventListener('focus', onFocus);
  void refresh();

  return {
    dispose(): void {
      disposed = true;
      clearTimer();
      window.removeEventListener('focus', onFocus);
    }
  };
}
