import type { ChatTalkState } from '../../voice/wake';
import { MIC_SVG } from '../shared/mic-button';
import { createPhraseListener, type PhraseListener, type PhraseListenerOptions } from '../shared/phrase-listener';
import { createListenPause, TYPING_RESUME_MS } from '../shared/listen-pause';
import { createVoiceReadiness } from '../shared/voice-readiness';

const MIC_RETRY_MS = 30000;
const MIC_ERROR = 'Не слышу микрофон';
const LISTEN_LABEL = 'Слушаю… нажмите на микрофон, чтобы писать текстом';

export interface TalkModeElements {
  level: HTMLElement;
  levelFill: HTMLElement;
  label: HTMLElement;
}

export interface TalkModeDeps {
  createListener?(options: PhraseListenerOptions): PhraseListener;
}

export interface TalkMode {
  button: HTMLButtonElement;
  keyboard(): void;
  dispose(): void;
}

// Переключатель разговора у поля ввода чата: та же wake-flow, что у питомца,
// только фразами управляет это окно.
export function createTalkMode(
  elements: TalkModeElements,
  onError: (message: string) => void,
  deps: TalkModeDeps = {}
): TalkMode {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mic-button';
  button.title = 'Разговор голосом';
  button.setAttribute('aria-label', 'Разговор голосом');
  button.disabled = true;
  button.innerHTML = MIC_SVG;

  let listener: PhraseListener | undefined;
  let conversation = false;
  let active = false;
  let threshold: number | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const pause = createListenPause((value) => listener?.pause(value));

  function clearRetry(): void {
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    }
  }

  function scheduleRetry(): void {
    if (retryTimer !== undefined) {
      return;
    }
    onError(MIC_ERROR);
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      startListener();
    }, MIC_RETRY_MS);
  }

  function stopListener(): void {
    clearRetry();
    listener?.stop();
    listener = undefined;
  }

  function onListenerError(): void {
    stopListener();
    if (conversation && active) {
      scheduleRetry();
    }
  }

  function startListener(): void {
    if (listener !== undefined || !conversation || !active) {
      return;
    }
    clearRetry();
    const options: PhraseListenerOptions = {
      threshold,
      onPhrase: (wav) => window.tishka.chatTalk.phrase(wav),
      onLevel: (level) => {
        elements.levelFill.style.width = `${Math.round(level * 100)}%`;
      },
      onError: onListenerError
    };
    listener = deps.createListener !== undefined ? deps.createListener(options) : createPhraseListener(options);
    if (pause.isPaused()) {
      listener.pause(true);
    }
    void listener.start().then((started) => {
      if (!started && listener !== undefined) {
        onListenerError();
      }
    });
  }

  function apply(state: ChatTalkState): void {
    button.classList.toggle('active', state.conversation);
    elements.level.hidden = !state.conversation;
    if (!state.conversation) {
      elements.levelFill.style.width = '0%';
    }
    elements.label.textContent = state.conversation ? LISTEN_LABEL : '';
    const nextThreshold = state.threshold ?? undefined;
    const thresholdChanged = nextThreshold !== threshold;
    threshold = nextThreshold;
    conversation = state.conversation;
    active = state.active;
    if (conversation && active) {
      // Новый порог применяется к идущей записи сразу: слушатель пересоздаётся.
      if (thresholdChanged && listener !== undefined) {
        stopListener();
      }
      startListener();
    } else {
      stopListener();
    }
  }

  button.addEventListener('click', () => {
    if (!button.disabled) {
      window.tishka.chatTalk.toggle();
    }
  });

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && listener !== undefined) {
      window.tishka.chatTalk.escape();
    }
  }

  document.addEventListener('keydown', onKeydown);

  const unsubscribe = window.tishka.chatTalk.onState(apply);

  const readiness = createVoiceReadiness({
    onReady(ready): void {
      button.disabled = !ready;
      button.title = ready ? 'Разговор голосом' : 'Распознавание речи не настроено';
    }
  });

  return {
    button,
    keyboard(): void {
      // Набор текста в поле: запись фраз на паузе, возобновление через 2 секунды
      // после последнего нажатия. Состояние значка микрофона не меняется.
      pause.hold('typing', TYPING_RESUME_MS);
      window.tishka.chatTalk.keyboard();
    },
    dispose(): void {
      stopListener();
      pause.dispose();
      readiness.dispose();
      document.removeEventListener('keydown', onKeydown);
      unsubscribe();
    }
  };
}
