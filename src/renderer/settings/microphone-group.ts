import type { Config } from '../../core/types';
import type { TranscribeResult } from '../../voice/stt-service';
import { createCalibrationPanel } from './calibration-panel';
import { createMicTestPanel } from './mic-test-panel';
import { createThresholdControl } from './threshold-control';
import { el, type SettingsSection } from './dom';

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
}

// Группа «Микрофон»: порог громкости, мастер калибровки и проверка микрофона.
export function createMicrophoneGroup(deps: MicrophoneGroupDeps): MicrophoneGroup {
  const threshold = createThresholdControl({
    getMic: deps.getMic,
    saveMic: deps.saveMic,
    onChanged: deps.onChanged
  });

  const calibration = createCalibrationPanel({
    getMic: deps.getMic,
    saveMic: deps.saveMic,
    dictate: deps.dictate,
    pause: deps.pause,
    onChanged: deps.onChanged
  });

  const micTest = createMicTestPanel({
    threshold: () => deps.getMic().threshold,
    dictate: deps.dictate,
    showError: deps.showError
  });

  const box = el('div', 'voice-group');
  box.append(
    el('h3', 'group-title', 'Микрофон'),
    threshold.element,
    calibration.controls,
    calibration.box,
    micTest.controls,
    micTest.box
  );

  function refresh(): void {
    threshold.refresh();
    calibration.refresh();
  }

  return { element: box, refresh };
}
