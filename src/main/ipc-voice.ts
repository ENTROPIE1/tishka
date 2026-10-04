import { ipcMain } from 'electron';
import { START_CANCELLED, type SttService, type TranscribeResult } from '../voice/stt-service';
import {
  VOICE_APPLY_CHANNEL,
  VOICE_CALIBRATION_CHANNEL,
  VOICE_CHECK_CHANNEL,
  VOICE_DICTATE_CHANNEL,
  VOICE_STATUS_CHANNEL
} from './ipc-channels';
import type { VoiceStateView } from './settings-types';

export interface VoiceIpcDeps {
  stt: SttService;
  reloadHotkey(hotkey: string): void;
  setCalibration(active: boolean): void;
}

function toBytes(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return undefined;
}

export function registerVoiceIpc(deps: VoiceIpcDeps): void {
  ipcMain.handle(VOICE_STATUS_CHANNEL, (): VoiceStateView => ({ state: deps.stt.status() }));

  // Диктовка в окнах: возвращает распознанный текст и не запускает агента.
  ipcMain.handle(VOICE_DICTATE_CHANNEL, (_event, value: unknown): Promise<TranscribeResult> => {
    const bytes = toBytes(value);
    if (bytes === undefined) {
      return Promise.resolve({ ok: false, error: 'Некорректные данные записи' });
    }
    return deps.stt.transcribe(bytes);
  });

  // «Проверить»: перезапускает службу распознавания и отдаёт её состояние.
  // Если запуск вытеснен новым, отдаём итог нового, а не «Запуск отменён».
  let generation = 0;
  let current: Promise<VoiceStateView> | undefined;
  async function check(): Promise<VoiceStateView> {
    generation += 1;
    const mine = generation;
    deps.stt.stop();
    const result = await deps.stt.start();
    if (result.error === START_CANCELLED && mine !== generation && current !== undefined) {
      return current;
    }
    const view: VoiceStateView = { state: deps.stt.status() };
    if (result.error !== undefined) {
      view.error = result.error;
    }
    return view;
  }
  ipcMain.handle(VOICE_CHECK_CHANNEL, (): Promise<VoiceStateView> => {
    const promise = check();
    current = promise;
    return promise;
  });

  ipcMain.handle(VOICE_APPLY_CHANNEL, (_event, hotkey: unknown) => {
    if (typeof hotkey === 'string' && hotkey.trim() !== '') {
      deps.reloadHotkey(hotkey.trim());
    }
  });

  // На время калибровки постоянное прослушивание и разговор приостанавливаются,
  // чтобы микрофон не перехватывало другое окно.
  ipcMain.handle(VOICE_CALIBRATION_CHANNEL, (_event, value: unknown) => {
    deps.setCalibration(value === true);
  });
}
