import { createRecorder } from '../shared/recorder';

export const LISTEN_SAY = 'Слушаю…';

export interface ListenUi {
  isListening(): boolean;
  escape(): void;
  setError(message: string): void;
  say(modelSay: string | undefined, state: string): string;
}

// Индикатор записи, кнопка микрофона и связь с главным процессом.
export function createListenUi(onStart: () => void): ListenUi {
  const level = document.getElementById('level') as HTMLElement;
  const levelFill = document.getElementById('level-fill') as HTMLElement;
  const mic = document.getElementById('mic') as HTMLElement;
  let listening = false;
  let error = '';

  function setListening(value: boolean): void {
    listening = value;
    level.hidden = !value;
    if (!value) {
      levelFill.style.width = '0%';
    }
  }

  const recorder = createRecorder({
    onLevel(value: number): void {
      levelFill.style.width = `${Math.round(value * 100)}%`;
    },
    onResult(result): void {
      setListening(false);
      window.tishka.pet.listenResult(result);
    }
  });

  mic.addEventListener('click', () => {
    window.tishka.pet.listenToggle();
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
    say(modelSay, state): string {
      if (state !== 'confused') {
        error = '';
      }
      if (listening) {
        return LISTEN_SAY;
      }
      return modelSay ?? (state === 'confused' ? error : '');
    }
  };
}
