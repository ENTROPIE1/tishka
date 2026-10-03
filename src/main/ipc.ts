import { BrowserWindow, ipcMain } from 'electron';
import type { EventBus, SecretStore, TishkaEvent } from '../core/types';
import {
  EVENT_CHANNEL,
  SECRETS_DELETE_CHANNEL,
  SECRETS_HAS_CHANNEL,
  SECRETS_NAMES_CHANNEL,
  SECRETS_SET_CHANNEL,
  USER_TEXT_CHANNEL
} from './ipc-channels';

export type UserTextHandler = (text: string) => void;

export function broadcastEvent(event: TishkaEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(EVENT_CHANNEL, event);
  }
}

export function registerIpc(
  bus: EventBus,
  onUserText: UserTextHandler,
  secrets: SecretStore
): void {
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

  ipcMain.handle(SECRETS_SET_CHANNEL, async (_event, name: unknown, value: unknown) => {
    if (typeof name !== 'string' || typeof value !== 'string') {
      return;
    }
    await secrets.set(name, value);
  });

  ipcMain.handle(SECRETS_HAS_CHANNEL, async (_event, name: unknown): Promise<boolean> => {
    if (typeof name !== 'string') {
      return false;
    }
    return secrets.has(name);
  });

  ipcMain.handle(SECRETS_DELETE_CHANNEL, async (_event, name: unknown) => {
    if (typeof name !== 'string') {
      return;
    }
    await secrets.delete(name);
  });

  ipcMain.handle(SECRETS_NAMES_CHANNEL, async (): Promise<string[]> => {
    return secrets.names();
  });
}
