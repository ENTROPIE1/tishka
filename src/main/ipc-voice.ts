import { ipcMain } from 'electron';
import type { SttService, TranscribeResult } from '../voice/stt-service';
import {
  VOICE_APPLY_CHANNEL,
  VOICE_CHECK_CHANNEL,
  VOICE_DICTATE_CHANNEL,
  VOICE_STATUS_CHANNEL
} from './ipc-channels';
import type { VoiceStateView } from './settings-types';

export interface VoiceIpcDeps {
  stt: SttService;
  reloadHotkey(hotkey: string): void;
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
  ipcMain.handle(VOICE_CHECK_CHANNEL, async (): Promise<VoiceStateView> => {
    deps.stt.stop();
    const result = await deps.stt.start();
    const view: VoiceStateView = { state: deps.stt.status() };
    if (result.error !== undefined) {
      view.error = result.error;
    }
    return view;
  });

  ipcMain.handle(VOICE_APPLY_CHANNEL, (_event, hotkey: unknown) => {
    if (typeof hotkey === 'string' && hotkey.trim() !== '') {
      deps.reloadHotkey(hotkey.trim());
    }
  });
}
