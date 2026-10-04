import type { Config } from '../../core/types';
import type { VadSensitivity } from '../../voice/vad';

export interface VoiceControls {
  hotkey: HTMLInputElement;
  wakeEnabled: HTMLInputElement;
  wakeWords: HTMLInputElement;
  talkTimeout: HTMLInputElement;
  sensitivity: HTMLSelectElement;
  exe: HTMLInputElement;
  model: HTMLInputElement;
}

export function parseWords(value: string, fallback: string[]): string[] {
  const words = value
    .split(',')
    .map((word) => word.trim())
    .filter((word) => word !== '');
  return words.length > 0 ? words : fallback;
}

export function parseTimeout(value: string, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : fallback;
}

// Сохраняет все три группы настроек голоса и применяет горячую клавишу.
export async function saveVoice(controls: VoiceControls): Promise<void> {
  const view = await window.tishka.config.get();
  const next: Config = {
    ...view.config,
    voice: {
      ...view.config.voice,
      hotkey: controls.hotkey.value.trim(),
      wakeEnabled: controls.wakeEnabled.checked,
      wakeWords: parseWords(controls.wakeWords.value, view.config.voice.wakeWords),
      talkTimeoutSec: parseTimeout(controls.talkTimeout.value, view.config.voice.talkTimeoutSec),
      sensitivity: controls.sensitivity.value as VadSensitivity,
      stt: {
        ...view.config.voice.stt,
        exe: controls.exe.value.trim(),
        model: controls.model.value.trim()
      }
    }
  };
  await window.tishka.config.save(next);
  await window.tishka.voice.apply(next.voice.hotkey);
}
