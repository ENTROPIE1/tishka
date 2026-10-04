import type { TranscribeResult } from '../../voice/stt-service';
import type { VadSensitivity } from '../../voice/vad';
import { createMicCheck } from '../shared/mic-check';
import { button, el } from './dom';

export interface MicTestPanel {
  controls: HTMLElement;   // кнопка «Проверить микрофон»
  box: HTMLElement;        // полоска уровня и текст, скрыт до первой проверки
}

export interface MicTestDeps {
  sensitivity(): VadSensitivity;
  dictate(wav: Uint8Array): Promise<TranscribeResult>;
  showError(message: string): void;
  durationMs?: number;
}

// Проверка микрофона: кнопка и скрытый до первого запуска блок с уровнем,
// подписью «слышу речь / тихо» и распознанным текстом.
export function createMicTestPanel(deps: MicTestDeps): MicTestPanel {
  const check = button('Проверить микрофон', 'button button-secondary');
  const fill = el('div', 'level-fill');
  const mark = el('div', 'level-mark');
  const level = el('div', 'level');
  level.append(fill, mark);
  const label = el('span', 'field-hint', '');
  const text = el('div', 'mic-check-text', '');
  const box = el('div', 'mic-check');
  box.append(level, label, text);
  box.hidden = true;

  check.addEventListener('click', () => {
    check.disabled = true;
    box.hidden = false;
    fill.style.width = '0%';
    label.textContent = 'Слушаю…';
    text.textContent = '';
    const run = createMicCheck(
      {
        onProgress(level, heard): void {
          fill.style.width = `${Math.round(level * 100)}%`;
          label.textContent = heard ? 'слышу речь' : 'тихо';
        },
        onDone(result): void {
          check.disabled = false;
          if (result.error !== undefined) {
            deps.showError(result.error);
            return;
          }
          if (result.wav === undefined) {
            label.textContent = 'тихо';
            text.textContent = 'Речь не услышана';
            return;
          }
          void deps
            .dictate(result.wav)
            .then((outcome) => {
              text.textContent = outcome.ok ? outcome.text : outcome.error;
            })
            .catch((error: unknown) => {
              deps.showError(error instanceof Error ? error.message : String(error));
            });
        }
      },
      { durationMs: deps.durationMs ?? 5000, sensitivity: deps.sensitivity() }
    );
    run.start();
  });

  return { controls: check, box };
}
