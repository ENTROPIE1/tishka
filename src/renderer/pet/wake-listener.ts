import { createPhraseListener, type PhraseListener, type PhraseListenerOptions } from '../shared/phrase-listener';
import type { VadSensitivity } from '../../voice/vad';

const MIC_RETRY_MS = 30000;
const MIC_ERROR = 'Не слышу микрофон';
const LISTEN_PAUSE_MS = 2000;

export interface WakeListenerDeps {
  onConversation?(on: boolean): void;
  onWaiting?(waiting: boolean): void;
  createListener?(options: PhraseListenerOptions): PhraseListener;
}

export interface WakeListener {
  setActive(active: boolean): void;
  keyboard(): void;
  dispose(): void;
}

// Окно-питомец: постоянное прослушивание ведёт общий phrase-listener,
// здесь остаётся только связка с состоянием окна.
export function createWakeListener(deps: WakeListenerDeps = {}): WakeListener {
  const level = document.getElementById('level') as HTMLElement | null;
  const levelFill = document.getElementById('level-fill') as HTMLElement | null;
  const mic = document.getElementById('mic') as HTMLElement | null;
  let active = false;
  let conversation = false;
  let waiting = false;
  let soon = false;
  let sensitivity: VadSensitivity = 'normal';
  let threshold: number | undefined;
  let listener: PhraseListener | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let pauseTimer: ReturnType<typeof setTimeout> | undefined;

  function clearRetry(): void {
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    }
  }

  function clearPause(): void {
    if (pauseTimer !== undefined) {
      clearTimeout(pauseTimer);
      pauseTimer = undefined;
    }
  }

  // Набор текста в строке ежа: запись на паузе, возобновление через 2 секунды
  // после последнего нажатия. Значок микрофона при этом не меняется.
  function pauseListening(): void {
    if (listener === undefined) {
      return;
    }
    listener.pause();
    clearPause();
    pauseTimer = setTimeout(() => {
      pauseTimer = undefined;
      listener?.resume();
    }, LISTEN_PAUSE_MS);
  }

  function scheduleRetry(): void {
    if (retryTimer !== undefined) {
      return;
    }
    window.tishka.pet.wakeError(MIC_ERROR);
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      if (active && listener === undefined) {
        start();
      }
    }, MIC_RETRY_MS);
  }

  function onError(): void {
    stopListener();
    if (active) {
      scheduleRetry();
    }
  }

  function start(): void {
    if (listener !== undefined || !active) {
      return;
    }
    const options: PhraseListenerOptions = {
      sensitivity,
      threshold,
      onPhrase: (wav) => window.tishka.pet.wakePhrase(wav),
      onLevel: (value) => {
        if (levelFill !== null && conversation) {
          levelFill.style.width = `${Math.round(value * 100)}%`;
        }
      },
      onError
    };
    listener = deps.createListener !== undefined ? deps.createListener(options) : createPhraseListener(options);
    void listener.start();
  }

  function stopListener(): void {
    clearRetry();
    clearPause();
    listener?.stop();
    listener = undefined;
  }

  function applyActive(): void {
    if (active) {
      start();
    } else {
      stopListener();
    }
  }

  function applyUi(): void {
    if (level !== null) {
      level.hidden = !(active && conversation);
    }
    if (!active || !conversation) {
      if (levelFill !== null) {
        levelFill.style.width = '0%';
      }
    }
    if (mic !== null) {
      mic.classList.toggle('on', conversation);
      mic.classList.toggle('waiting', waiting);
      mic.classList.toggle('soon', active && conversation && soon);
    }
  }

  window.tishka.pet.onWakeState((state) => {
    const wasActive = active;
    active = state.active;
    soon = state.soon;
    const nextSensitivity = state.sensitivity ?? sensitivity;
    const sensitivityChanged = nextSensitivity !== sensitivity;
    sensitivity = nextSensitivity;
    const nextThreshold = state.threshold ?? undefined;
    const thresholdChanged = nextThreshold !== threshold;
    threshold = nextThreshold;
    if (state.conversation !== conversation) {
      conversation = state.conversation;
      deps.onConversation?.(conversation);
    }
    const nextWaiting = state.waiting === true;
    if (nextWaiting !== waiting) {
      waiting = nextWaiting;
      deps.onWaiting?.(waiting);
    }
    if (active && (!wasActive || sensitivityChanged || thresholdChanged) && listener !== undefined) {
      stopListener();
    }
    applyActive();
    applyUi();
  });

  return {
    setActive(value): void {
      active = value;
      applyActive();
      applyUi();
    },
    keyboard(): void {
      pauseListening();
    },
    dispose(): void {
      active = false;
      stopListener();
    }
  };
}
