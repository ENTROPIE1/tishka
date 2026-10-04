import { createRecorder } from '../shared/recorder';
import { createVad } from '../../voice/vad';

export const LISTEN_SAY = 'Слушаю…';

export interface BubbleSay {
  modelSay?: string;      // текст ответа или приветствия, пришедший из ядра
  state: string;
  listening: boolean;     // идёт запись по вызову или кнопке
  conversation: boolean;  // включён режим разговора
  error?: string;
}

// Что показывать в облачке: текст приветствия или ответа важнее «Слушаю…»,
// а «Слушаю…» — только пока действительно идёт запись.
export function bubbleSay(input: BubbleSay): string {
  if (input.modelSay !== undefined && input.modelSay !== '') {
    return input.modelSay;
  }
  if (input.listening || input.conversation) {
    return LISTEN_SAY;
  }
  return input.state === 'confused' ? (input.error ?? '') : '';
}

export interface ListenUi {
  isListening(): boolean;
  escape(): void;
  setError(message: string): void;
  setConversation(on: boolean): void;
  say(modelSay: string | undefined, state: string): string;
}

// Индикатор записи, кнопка микрофона и связь с главным процессом.
export function createListenUi(onStart: () => void, getThreshold?: () => number | null): ListenUi {
  const level = document.getElementById('level') as HTMLElement;
  const levelFill = document.getElementById('level-fill') as HTMLElement;
  const mic = document.getElementById('mic') as HTMLElement;
  let listening = false;
  let conversation = false;
  let error = '';

  function setListening(value: boolean): void {
    listening = value;
    level.hidden = !value;
    if (!value) {
      levelFill.style.width = '0%';
    }
  }

  const recorder = createRecorder({
    makeVad: () => createVad({ threshold: getThreshold?.() ?? undefined }),
    onLevel(value: number): void {
      levelFill.style.width = `${Math.round(value * 100)}%`;
    },
    onResult(result): void {
      setListening(false);
      window.tishka.pet.listenResult(result);
    }
  });

  mic.addEventListener('click', () => {
    window.tishka.pet.conversationToggle();
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && listening) {
      event.preventDefault();
      recorder.cancel();
    }
  });

  window.tishka.pet.onListenCommand((command) => {
    if (command === 'start') {
      setListening(true);
      onStart();
      void recorder.start();
    } else if (command === 'stop') {
      recorder.stop();
    } else {
      recorder.cancel();
    }
  });

  return {
    isListening: () => listening,
    escape(): void {
      recorder.cancel();
    },
    setError(message: string): void {
      error = message;
    },
    setConversation(on): void {
      conversation = on;
    },
    say(modelSay, state): string {
      if (state !== 'confused') {
        error = '';
      }
      return bubbleSay({ modelSay, state, listening, conversation, error });
    }
  };
}
