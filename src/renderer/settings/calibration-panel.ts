import type { Config } from '../../core/types';
import type { TranscribeResult } from '../../voice/stt-service';
import { createMicCapture } from '../shared/mic-capture';
import { button, el } from './dom';
import {
  createCalibrationFlow,
  NOISE_MESSAGE,
  SPEECH_MESSAGE,
  type CalibrationState
} from './calibration-flow';

export interface CalibrationPanelDeps {
  getMic(): Config['voice']['mic'];
  saveMic(mic: Config['voice']['mic']): Promise<void>;
  dictate(wav: Uint8Array): Promise<TranscribeResult>;
  pause(active: boolean): void;
  onChanged?(): void;
  now?(): number;
}

export interface CalibrationPanel {
  controls: HTMLElement;
  box: HTMLElement;
  refresh(): void;
}

const EMPTY_STATUS = 'Не откалиброван — работает порог по умолчанию';
const RESET_MIC: Config['voice']['mic'] = { threshold: null, noise: null, speech: null, calibratedAt: null };

function two(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatCalibrated(iso: string, nowMs: number): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return EMPTY_STATUS;
  }
  const now = new Date(nowMs);
  const time = `${two(date.getHours())}:${two(date.getMinutes())}`;
  if (date.toDateString() === now.toDateString()) {
    return `Откалиброван сегодня в ${time}`;
  }
  return `Откалиброван ${two(date.getDate())}.${two(date.getMonth() + 1)}.${date.getFullYear()} в ${time}`;
}

export function createCalibrationPanel(deps: CalibrationPanelDeps): CalibrationPanel {
  const now = deps.now ?? (() => Date.now());
  const calibrate = button('Откалибровать микрофон', 'button button-secondary');
  const status = el('span', 'field-hint', EMPTY_STATUS);
  const reset = button('Сбросить калибровку', 'button button-danger');
  const controls = el('div', 'calib-controls');
  controls.append(calibrate, status, reset);

  const stepLabel = el('div', 'calib-step', '');
  const fill = el('div', 'level-fill');
  const level = el('div', 'level');
  level.append(fill);
  const countdown = el('div', 'calib-countdown', '');
  const scale = el('div', 'calib-scale');
  const noiseMark = el('div', 'calib-mark');
  const thresholdMark = el('div', 'calib-mark calib-mark-threshold');
  const speechMark = el('div', 'calib-mark calib-mark-speech');
  const noiseText = el('span', 'calib-mark-text', 'шум');
  const thresholdText = el('span', 'calib-mark-text', 'порог');
  const speechText = el('span', 'calib-mark-text', 'речь');
  noiseMark.append(noiseText);
  thresholdMark.append(thresholdText);
  speechMark.append(speechText);
  scale.append(noiseMark, thresholdMark, speechMark);
  const message = el('div', 'calib-message', '');
  const recognized = el('div', 'calib-recognized', '');
  const saveButton = button('Сохранить');
  const cancelButton = button('Отмена', 'button button-secondary');
  const repeatButton = button('Повторить', 'button button-secondary');
  const actions = el('div', 'row');
  actions.append(repeatButton, saveButton, cancelButton);
  const box = el('div', 'calib');
  box.append(stepLabel, level, countdown, scale, message, recognized, actions);
  box.hidden = true;

  const flow = createCalibrationFlow({
    mic: createMicCapture(),
    now,
    transcribe: (wav) => deps.dictate(wav),
    save: (mic) => deps.saveMic(mic),
    onPause: () => deps.pause(true),
    onResume: () => deps.pause(false),
    onUpdate: render
  });

  function setWidth(node: HTMLElement, value: number): void {
    node.style.left = `${Math.max(0, Math.min(100, Math.round(value * 100)))}%`;
  }

  function render(state: CalibrationState): void {
    if (state.step === 'idle') {
      box.hidden = true;
      scale.hidden = true;
      calibrate.disabled = false;
      return;
    }
    box.hidden = false;
    scale.hidden = state.step !== 'result';
    repeatButton.hidden = state.outcome?.quality !== 'bad';
    saveButton.hidden = state.step === 'result' && state.outcome?.threshold === null;
    if (state.step === 'noise') {
      stepLabel.textContent = NOISE_MESSAGE;
      countdown.textContent = state.secondsLeft > 0 ? `осталось ${state.secondsLeft} с` : '';
      fill.style.width = `${Math.round(state.level * 100)}%`;
    } else if (state.step === 'speech') {
      stepLabel.textContent = SPEECH_MESSAGE;
      countdown.textContent = '';
      fill.style.width = `${Math.round(state.level * 100)}%`;
    } else {
      stepLabel.textContent = '';
      countdown.textContent = '';
      fill.style.width = '0%';
      const outcome = state.outcome;
      if (outcome !== undefined) {
        message.textContent = outcome.message;
        recognized.textContent = outcome.recognized !== '' ? `Я услышал: ${outcome.recognized}` : '';
        const max = Math.max(outcome.noise, outcome.speech, outcome.threshold ?? 0, 0.01) * 1.1;
        setWidth(noiseMark, outcome.noise / max);
        setWidth(speechMark, outcome.speech / max);
        setWidth(thresholdMark, (outcome.threshold ?? 0) / max);
      }
    }
  }

  function refresh(): void {
    const mic = deps.getMic();
    status.textContent = mic.calibratedAt !== null ? formatCalibrated(mic.calibratedAt, now()) : EMPTY_STATUS;
    reset.disabled = mic.calibratedAt === null;
  }

  calibrate.addEventListener('click', () => {
    if (!flow.isActive()) {
      void flow.start();
    }
  });
  cancelButton.addEventListener('click', () => flow.cancel());
  repeatButton.addEventListener('click', () => {
    flow.cancel();
    void flow.start();
  });
  saveButton.addEventListener('click', () => {
    void flow.save().then(() => {
      refresh();
      deps.onChanged?.();
    });
  });
  reset.addEventListener('click', () => {
    void deps.saveMic(RESET_MIC).then(() => {
      refresh();
      deps.onChanged?.();
    });
  });

  refresh();

  return { controls, box, refresh };
}
