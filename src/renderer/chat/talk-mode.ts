import type { ChatTalkState } from '../../voice/wake';
import { MIC_SVG } from '../shared/mic-button';
import { createPhraseListener, type PhraseListener } from '../shared/phrase-listener';

const READY_POLL_MS = 1500;
const READY_POLL_LIMIT = 40;
const LISTEN_LABEL = 'Слушаю… нажмите на микрофон, чтобы писать текстом';

export interface TalkModeElements {
  level: HTMLElement;
  levelFill: HTMLElement;
  label: HTMLElement;
}

export interface TalkMode {
  button: HTMLButtonElement;
  keyboard(): void;
  dispose(): void;
}

// Переключатель разговора у поля ввода чата: та же wake-flow, что у питомца,
// только фразами управляет это окно.
export function createTalkMode(elements: TalkModeElements, onError: (message: string) => void): TalkMode {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mic-button';
  button.title = 'Разговор голосом';
  button.setAttribute('aria-label', 'Разговор голосом');
  button.disabled = true;
  button.innerHTML = MIC_SVG;

  let listener: PhraseListener | undefined;
  let attempts = 0;

  function stopListener(): void {
    listener?.stop();
    listener = undefined;
  }

  function apply(state: ChatTalkState): void {
    button.classList.toggle('active', state.conversation);
    elements.level.hidden = !state.conversation;
    if (!state.conversation) {
      elements.levelFill.style.width = '0%';
    }
    elements.label.textContent = state.conversation ? LISTEN_LABEL : '';
    if (state.conversation && listener === undefined) {
      listener = createPhraseListener({
        sensitivity: state.sensitivity,
        threshold: state.threshold ?? undefined,
        onPhrase: (wav) => window.tishka.chatTalk.phrase(wav),
        onLevel: (level) => {
          elements.levelFill.style.width = `${Math.round(level * 100)}%`;
        },
        onError
      });
      void listener.start();
    } else if (!state.conversation) {
      stopListener();
    }
  }

  button.addEventListener('click', () => {
    if (!button.disabled) {
      window.tishka.chatTalk.toggle();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && listener !== undefined) {
      window.tishka.chatTalk.escape();
    }
  });

  const unsubscribe = window.tishka.chatTalk.onState(apply);

  function refresh(): void {
    void window.tishka.voice
      .status()
      .then((view) => {
        const ready = view.state === 'ready';
        button.disabled = !ready;
        button.title = ready ? 'Разговор голосом' : 'Распознавание речи не настроено';
        if (!ready && attempts < READY_POLL_LIMIT) {
          attempts += 1;
          window.setTimeout(refresh, READY_POLL_MS);
        }
      })
      .catch(() => {
        button.disabled = true;
      });
  }

  refresh();

  return {
    button,
    keyboard: () => window.tishka.chatTalk.keyboard(),
    dispose(): void {
      stopListener();
      unsubscribe();
    }
  };
}
