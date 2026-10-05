import { wavDurationSec } from '../voice/wav';
import type { SpeakMessage } from '../voice/speech-queue';

export interface PetSpeakPlayDeps {
  speak(message: SpeakMessage): void;
  stopSpeaking(): void;
  setTimer?: (handler: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

export interface PetSpeakPlay {
  play(message: SpeakMessage, signal: AbortSignal): Promise<void>;
  done(id: number | undefined): void;
  abort(): void;
}

const SPEECH_MARGIN_MS = 5000;
const MIN_TIMEOUT_MS = 15000;

// Страховочный срок считается от длины звука: сама запись плюс запас.
// Минимум страхует зависший звук, когда длину записи определить не удалось.
export function speakTimeoutMs(wav: Uint8Array): number {
  return Math.max(wavDurationSec(wav) * 1000 + SPEECH_MARGIN_MS, MIN_TIMEOUT_MS);
}

interface PendingPlay {
  id: number;
  resolve(): void;
  cleanup(): void;
}

// Обещание одного воспроизведения завершается по speak-done, по abort сигнала,
// по сроку или при вытеснении следующим play. Номер воспроизведения отделяет
// запоздавшее speak-done прежнего звука от текущего.
export function createPetSpeakPlay(deps: PetSpeakPlayDeps): PetSpeakPlay {
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
      }, speakTimeoutMs(message.wav));
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
