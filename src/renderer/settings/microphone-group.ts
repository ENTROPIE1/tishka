import type { Config } from '../../core/types';
import type { TranscribeResult } from '../../voice/stt-service';
import type { VadSensitivity } from '../../voice/vad';
import { createCalibrationPanel } from './calibration-panel';
import { createMicTestPanel } from './mic-test-panel';
import { el, field, selectInput, type SettingsSection } from './dom';

const SENSITIVITY_OPTIONS = [
  { value: 'low', label: 'Низкая — только громкая речь' },
  { value: 'normal', label: 'Обычная' },
  { value: 'high', label: 'Высокая — тихая речь' }
];

const SENSITIVITY_HINT = 'Насколько тихую речь слышать; если Тишка отвечает «Не расслышал», поднимите';
const CALIBRATED_HINT = 'Используется калибровка; уровень применяется, если её сбросить';

export interface MicrophoneGroupDeps {
  getMic(): Config['voice']['mic'];
  saveMic(mic: Config['voice']['mic']): Promise<void>;
  dictate(wav: Uint8Array): Promise<TranscribeResult>;
  pause(active: boolean): void;
  showError(message: string): void;
  onChanged?(): void;
}

export interface MicrophoneGroup extends SettingsSection {
  element: HTMLElement;
  sensitivity: HTMLSelectElement;
}

// Группа «Микрофон»: ручной уровень, мастер калибровки и проверка микрофона.
export function createMicrophoneGroup(deps: MicrophoneGroupDeps): MicrophoneGroup {
  const sensitivity = selectInput(SENSITIVITY_OPTIONS, 'normal');
  const sensitivityHint = el('span', 'field-hint', SENSITIVITY_HINT);
  const sensitivityField = field('Чувствительность микрофона', sensitivity);
  sensitivityField.append(sensitivityHint);

  const calibration = createCalibrationPanel({
    getMic: deps.getMic,
    saveMic: deps.saveMic,
    dictate: deps.dictate,
    pause: deps.pause,
    onChanged: deps.onChanged
  });

  const micTest = createMicTestPanel({
    sensitivity: () => sensitivity.value as VadSensitivity,
    threshold: () => deps.getMic().threshold,
    dictate: deps.dictate,
    showError: deps.showError
  });

  const box = el('div', 'voice-group');
  box.append(
    el('h3', 'group-title', 'Микрофон'),
    sensitivityField,
    calibration.controls,
    calibration.box,
    micTest.controls,
    micTest.box
  );

  function refresh(): void {
    const calibrated = deps.getMic().calibratedAt !== null;
    sensitivityHint.textContent = calibrated ? CALIBRATED_HINT : SENSITIVITY_HINT;
    calibration.refresh();
  }

  return { element: box, sensitivity, refresh };
}
