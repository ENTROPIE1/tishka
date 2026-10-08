import { createRecorder } from '../shared/recorder';
import { createVad } from '../../voice/vad';

export interface BubbleSay {
  modelSay?: string;      // текст ответа, приветствия или статуса, пришедший из ядра
  state: string;
  error?: string;
}

// Облачко — для слов Тишки: ответ, приветствие, статус или ошибка.
// Состояние записи показывают значок микрофона и подпись под ежом, не облачко.
export function bubbleSay(input: BubbleSay): string {
  if (input.modelSay !== undefined && input.modelSay !== '') {
    return input.modelSay;
  }
  return input.state === 'confused' ? (input.error ?? '') : '';
}

export interface ListenUi {
  isListening(): boolean;
  escape(): void;
  // Начало печати отменяет идущую разовую запись молча: она не должна
  // завершиться пустой и сообщить «Не расслышал» поверх ответа.
  cancel(): void;
  setError(message: string): void;
  say(modelSay: string | undefined, state: string): string;
}

// Разовая запись строки, кнопка микрофона и связь с главным процессом.
// О начале и конце записи сообщает onListeningChange: значок и полоска уровня.
export function createListenUi(
  onListeningChange: (listening: boolean) => void,
  getThreshold?: () => number | null
): ListenUi {
  const levelFill = document.getElementById('level-fill') as HTMLElement;
  const mic = document.getElementById('mic') as HTMLElement;
  let listening = false;
  let error = '';

  function setListening(value: boolean): void {
    listening = value;
    if (!value) {
      levelFill.style.width = '0%';
    }
    onListeningChange(value);
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

  mic.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
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
    cancel(): void {
      recorder.cancel();
    },
    setError(message: string): void {
      error = message;
    },
    say(modelSay, state): string {
      if (state !== 'confused') {
        error = '';
      }
      return bubbleSay({ modelSay, state, error });
    }
  };
}
