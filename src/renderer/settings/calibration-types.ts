import type { Config } from '../../core/types';
import type { TranscribeResult } from '../../voice/stt-service';
import type { CalibrationQuality } from '../../voice/calibration';

export type CalibrationStep = 'idle' | 'noise' | 'speech' | 'result';

export const NOISE_MESSAGE = 'Помолчите три секунды — слушаю комнату';
export const SPEECH_MESSAGE = 'Теперь скажите обычным голосом: „Тишка, какие у меня сегодня встречи?“';
export const GOOD_MESSAGE = 'Готово. Тишка хорошо вас слышит';
export const WEAK_MESSAGE = 'Слышу, но слабо. Сядьте ближе к микрофону или прибавьте уровень микрофона в настройках звука Windows';
export const NOISY_MESSAGE = 'Не получилось: речь почти не отличается от шума';
export const NO_SPEECH_MESSAGE = 'Речь не услышана';
export const REPEAT_LABEL = 'Повторить';
export const SAVE_LABEL = 'Сохранить';
export const CANCEL_LABEL = 'Отмена';

export const NOISE_MS = 3000;
export const NOISE_SKIP_MS = 300;
export const SPEECH_MAX_MS = 8000;
export const SPEECH_SILENCE_MS = 1500;
export const SPEECH_GUARD = 1.5;
export const TARGET_RATE = 16000;
export const DISPLAY_SCALE = 0.1;

export interface CalibrationOutcome {
  quality: CalibrationQuality;
  message: string;
  recognized: string;
  threshold: number | null;
  noise: number;
  speech: number;
}

export interface CalibrationState {
  step: CalibrationStep;
  level: number;
  secondsLeft: number;
  outcome?: CalibrationOutcome;
}

export interface CalibrationMic {
  start(onFrame: (frame: Float32Array, sampleRate: number) => void): Promise<boolean>;
  stop(): void;
}

export interface CalibrationDeps {
  mic: CalibrationMic;
  now(): number;
  transcribe(wav: Uint8Array): Promise<TranscribeResult>;
  save(mic: Config['voice']['mic']): Promise<void>;
  onPause?(): void;
  onResume?(): void;
  onUpdate(state: CalibrationState): void;
}

export interface CalibrationFlow {
  start(): Promise<void>;
  cancel(): void;
  save(): Promise<void>;
  isActive(): boolean;
  state(): CalibrationState;
}
