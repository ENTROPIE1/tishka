import { createVad } from '../../voice/vad';
import { createRecorder } from './recorder';

export interface MicButtonOptions {
  onText(text: string): void;
  onLevel(level: number): void;
  onListeningChange(listening: boolean): void;
  onError?(message: string): void;
  getThreshold?(): number | null;
}

export interface MicButton {
  element: HTMLButtonElement;
  isListening(): boolean;
  cancel(): void;
}

export const MIC_SVG =
  '<svg class="mic-icon" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" />' +
  '<path d="M5 11a7 7 0 0 0 14 0" />' +
  '<path d="M12 18v3" /></svg>';

const MAX_RECORD_MS = 60000;
const SILENCE_MS = 2000;
const READY_POLL_MS = 1500;
const READY_POLL_LIMIT = 40;

// Кнопка с микрофоном: запись, распознавание через главный процесс и вставка текста.
export function createMicButton(options: MicButtonOptions): MicButton {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mic-button';
  button.title = 'Распознавание речи не настроено';
  button.setAttribute('aria-label', 'Сказать голосом');
  button.disabled = true;
  button.innerHTML = MIC_SVG;

  let listening = false;
  let attempts = 0;

  function setListening(value: boolean): void {
    listening = value;
    button.classList.toggle('recording', value);
    options.onListeningChange(value);
  }

  async function dictate(data: Uint8Array): Promise<void> {
    try {
      const outcome = await window.tishka.voice.dictate(data);
      if (outcome.ok) {
        options.onText(outcome.text);
      } else {
        options.onError?.(outcome.error);
      }
    } catch (error) {
      options.onError?.(error instanceof Error ? error.message : String(error));
    }
  }

  const recorder = createRecorder({
    onLevel: options.onLevel,
    onResult(result): void {
      setListening(false);
      if (result.kind === 'wav') {
        void dictate(result.data);
      } else if (result.kind === 'error') {
        options.onError?.(result.message);
      } else if (result.kind === 'nospeech') {
        options.onError?.('Не расслышал');
      }
    },
    makeVad: () =>
      createVad({
        maxMs: MAX_RECORD_MS,
        silenceMs: SILENCE_MS,
        threshold: options.getThreshold?.() ?? undefined
      })
  });

  function refresh(): void {
    void window.tishka.voice
      .status()
      .then((view) => {
        const ready = view.state === 'ready';
        button.disabled = !ready;
        button.title = ready ? 'Сказать голосом' : 'Распознавание речи не настроено';
        if (!ready && attempts < READY_POLL_LIMIT) {
          attempts += 1;
          window.setTimeout(refresh, READY_POLL_MS);
        }
      })
      .catch(() => {
        button.disabled = true;
      });
  }

  button.addEventListener('click', () => {
    if (listening) {
      recorder.stop();
      return;
    }
    if (button.disabled) {
      return;
    }
    setListening(true);
    void recorder.start().then((started) => {
      if (!started) {
        setListening(false);
      }
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && listening) {
      recorder.cancel();
    }
  });

  refresh();

  return {
    element: button,
    isListening: () => listening,
    cancel: () => recorder.cancel()
  };
}
