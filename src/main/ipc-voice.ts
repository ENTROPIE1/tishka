import { ipcMain } from 'electron';
import type { SttService } from '../voice/stt-service';
import { VOICE_APPLY_CHANNEL, VOICE_CHECK_CHANNEL, VOICE_STATUS_CHANNEL } from './ipc-channels';
import type { VoiceStateView } from './settings-types';

export interface VoiceIpcDeps {
  stt: SttService;
  reloadHotkey(hotkey: string): void;
}

export function registerVoiceIpc(deps: VoiceIpcDeps): void {
  ipcMain.handle(VOICE_STATUS_CHANNEL, (): VoiceStateView => ({ state: deps.stt.status() }));

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
