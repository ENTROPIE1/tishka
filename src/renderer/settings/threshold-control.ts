import type { Config } from '../../core/types';
import { DEFAULT_MIC_THRESHOLD } from '../../voice/vad';
import { createMicCapture } from '../shared/mic-capture';
import { el, field } from './dom';

// Границы ползунка порога громкости, уровень сигнала микрофона (RMS).
export const THRESHOLD_MIN = 0.0015;
export const THRESHOLD_MAX = 0.1;
const STEPS = 200;

const THRESHOLD_HINT =
  'Звук тише порога считается тишиной. Если Тишка отвечает «Не расслышал» или слушает без пауз, поднимите порог';

export interface ThresholdControlDeps {
  getMic(): Config['voice']['mic'];
  saveMic(mic: Config['voice']['mic']): Promise<void>;
  onChanged?(): void;
}

export interface ThresholdControl {
  element: HTMLElement;
  refresh(): void;
}

// Ползунок движется по логарифмической шкале: тихая комната — в начале,
// громкая — в конце, точная подстройка возле рабочих значений.
function toStep(value: number): number {
  const ratio = Math.log(value / THRESHOLD_MIN) / Math.log(THRESHOLD_MAX / THRESHOLD_MIN);
  return Math.round(Math.max(0, Math.min(1, ratio)) * STEPS);
}

function fromStep(step: number): number {
  return THRESHOLD_MIN * (THRESHOLD_MAX / THRESHOLD_MIN) ** (step / STEPS);
}

function format(value: number): string {
  return value.toFixed(4).replace('.', ',').replace(/0+$/, '').replace(/,$/, '');
}

function rms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i += 1) {
    sum += frame[i] * frame[i];
  }
  return frame.length === 0 ? 0 : Math.sqrt(sum / frame.length);
}

// Ползунок порога рядом с живой полоской уровня микрофона; на полоске черта
// порога. Значение из настроек применяется сразу, калибровка ставит его,
// сброс возвращает по умолчанию.
export function createThresholdControl(deps: ThresholdControlDeps): ThresholdControl {
  const range = el('input', 'range-input') as HTMLInputElement;
  range.type = 'range';
  range.min = '0';
  range.max = String(STEPS);
  range.step = '1';
  const fill = el('div', 'level-fill');
  const mark = el('div', 'level-mark');
  const bar = el('div', 'threshold-level');
  bar.append(fill, mark);
  const valueLabel = el('span', 'threshold-value', '');
  const hint = el('span', 'field-hint', THRESHOLD_HINT);
  const box = field('Порог громкости', range);
  box.append(bar, valueLabel, hint);

  let current = DEFAULT_MIC_THRESHOLD;
  let listening = false;
  const capture = createMicCapture();

  // Полоска показывает звук относительно порога: черта посередине — порог,
  // звук громче порога заходит за неё.
  function draw(frame: Float32Array): void {
    const level = Math.max(0, Math.min(1, rms(frame) / (2 * current)));
    fill.style.width = `${Math.round(level * 100)}%`;
  }

  function listen(): void {
    if (listening) {
      return;
    }
    listening = true;
    window.addEventListener('beforeunload', () => capture.stop());
    void capture.start(draw);
  }

  function render(): void {
    current = deps.getMic().threshold ?? DEFAULT_MIC_THRESHOLD;
    range.value = String(toStep(current));
    valueLabel.textContent = `порог ${format(current)}`;
  }

  range.addEventListener('input', () => {
    valueLabel.textContent = `порог ${format(fromStep(Number(range.value)))}`;
  });

  range.addEventListener('change', () => {
    void deps
      .saveMic({ ...deps.getMic(), threshold: fromStep(Number(range.value)) })
      .then(() => deps.onChanged?.());
  });

  render();

  // Полоска живёт, пока открыт экран «Голос»: refresh вызывается при каждом показе.
  return {
    element: box,
    refresh(): void {
      render();
      listen();
    }
  };
}
