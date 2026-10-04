import type { SpeakMessage } from '../voice/speech-queue';

export interface PetSpeakPlayDeps {
  speak(message: SpeakMessage): void;
  stopSpeaking(): void;
  timeoutMs?: number;
  setTimer?: (handler: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

export interface PetSpeakPlay {
  play(message: SpeakMessage, signal: AbortSignal): Promise<void>;
  done(id: number | undefined): void;
  abort(): void;
}

const DEFAULT_TIMEOUT_MS = 60000;

interface PendingPlay {
  id: number;
  resolve(): void;
  cleanup(): void;
}

// Обещание одного воспроизведения завершается по speak-done, по abort сигнала,
// по сроку или при вытеснении следующим play. Номер воспроизведения отделяет
// запоздавшее speak-done прежнего звука от текущего.
export function createPetSpeakPlay(deps: PetSpeakPlayDeps): PetSpeakPlay {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const setTimer = deps.setTimer ?? ((handler, ms) => setTimeout(handler, ms));
  const clearTimer = deps.clearTimer ?? ((timer) => clearTimeout(timer));
  let lastId = 0;
  let pending: PendingPlay | undefined;

  function settle(): void {
    const item = pending;
    if (item === undefined) {
      return;
    }
    pending = undefined;
    item.cleanup();
    item.resolve();
  }

  function play(message: SpeakMessage, signal: AbortSignal): Promise<void> {
    settle();
    return new Promise<void>((resolve) => {
      const id = lastId + 1;
      lastId = id;
      const onAbort = (): void => {
        deps.stopSpeaking();
        settle();
      };
      const timer = setTimer(() => {
        deps.stopSpeaking();
        settle();
      }, timeoutMs);
      const cleanup = (): void => {
        clearTimer(timer);
        signal.removeEventListener('abort', onAbort);
      };
      pending = { id, resolve, cleanup };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      deps.speak({ ...message, id });
    });
  }

  return {
    play,
    done(id): void {
      if (pending !== undefined && pending.id === id) {
        settle();
      }
    },
    abort(): void {
      settle();
    }
  };
}
