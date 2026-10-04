import type { VadSensitivity } from '../../voice/vad';
import type { ChatTalkState } from '../../voice/wake';
import { MIC_SVG } from '../shared/mic-button';
import { createPhraseListener, type PhraseListener, type PhraseListenerOptions } from '../shared/phrase-listener';
import { createVoiceReadiness } from '../shared/voice-readiness';

const MIC_RETRY_MS = 30000;
const MIC_ERROR = 'Не слышу микрофон';
const LISTEN_PAUSE_MS = 2000;
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
  let sensitivity: VadSensitivity = 'normal';
  let threshold: number | undefined;
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

  // Набор текста в поле: запись фраз на паузе, возобновление через 2 секунды
  // после последнего нажатия. Состояние значка микрофона не меняется.
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
    onError(MIC_ERROR);
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      startListener();
    }, MIC_RETRY_MS);
  }

  function stopListener(): void {
    clearRetry();
    clearPause();
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
      sensitivity,
      threshold,
      onPhrase: (wav) => window.tishka.chatTalk.phrase(wav),
      onLevel: (level) => {
        elements.levelFill.style.width = `${Math.round(level * 100)}%`;
      },
      onError: onListenerError
    };
    listener = deps.createListener !== undefined ? deps.createListener(options) : createPhraseListener(options);
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
    sensitivity = state.sensitivity;
    threshold = state.threshold ?? undefined;
    conversation = state.conversation;
    active = state.active;
    if (conversation && active) {
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
      pauseListening();
      window.tishka.chatTalk.keyboard();
    },
    dispose(): void {
      stopListener();
      readiness.dispose();
      document.removeEventListener('keydown', onKeydown);
      unsubscribe();
    }
  };
}
