import { ipcMain } from 'electron';
import type { TtsHealth } from '../voice/tts-client';
import { SPEECH_HEALTH_CHANNEL, SPEECH_SAY_CHANNEL } from './ipc-channels';
import type { SpeechOutput } from './pet-speak';

export function registerSpeechIpc(speech: SpeechOutput): void {
  ipcMain.handle(SPEECH_HEALTH_CHANNEL, (): Promise<TtsHealth> => speech.health());
  ipcMain.handle(SPEECH_SAY_CHANNEL, () => {
    speech.sayExample();
  });
}
