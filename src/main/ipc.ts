import { BrowserWindow, ipcMain } from 'electron';
import type { EventBus, TishkaEvent } from '../core/types';
import { EVENT_CHANNEL, USER_TEXT_CHANNEL } from './ipc-channels';

export type UserTextHandler = (text: string) => void;

export function broadcastEvent(event: TishkaEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(EVENT_CHANNEL, event);
  }
}

export function registerIpc(bus: EventBus, onUserText: UserTextHandler): void {
  bus.on(broadcastEvent);

  ipcMain.on(USER_TEXT_CHANNEL, (_event, text: unknown) => {
    if (typeof text !== 'string') {
      return;
    }
    const trimmed = text.trim();
    if (trimmed !== '') {
      onUserText(trimmed);
    }
  });
}
