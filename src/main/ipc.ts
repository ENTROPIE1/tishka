import { BrowserWindow, clipboard, ipcMain, shell } from 'electron';
import type { TishkaCore } from '../core/app';
import type { EventBus, SecretStore, TishkaEvent } from '../core/types';
import {
  COPY_TEXT_CHANNEL,
  EVENT_CHANNEL,
  HISTORY_CHANNEL,
  HISTORY_CLEAR_CHANNEL,
  OPEN_EXTERNAL_CHANNEL,
  SECRETS_DELETE_CHANNEL,
  SECRETS_HAS_CHANNEL,
  SECRETS_NAMES_CHANNEL,
  SECRETS_SET_CHANNEL,
  USER_TEXT_CHANNEL
} from './ipc-channels';

export function broadcastEvent(event: TishkaEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(EVENT_CHANNEL, event);
  }
}

// Окно открывает только ссылки http и https, всё остальное игнорируется.
function isWebUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function registerIpc(bus: EventBus, core: TishkaCore, secrets: SecretStore): void {
  bus.on(broadcastEvent);

  ipcMain.on(USER_TEXT_CHANNEL, (_event, text: unknown) => {
    if (typeof text !== 'string') {
      return;
    }
    const trimmed = text.trim();
    if (trimmed !== '') {
      void core.handleUserText(trimmed).catch(() => undefined);
    }
  });

  ipcMain.handle(HISTORY_CHANNEL, (_event, limit: unknown) => {
    return core.history(typeof limit === 'number' ? limit : undefined);
  });

  ipcMain.handle(HISTORY_CLEAR_CHANNEL, async () => {
    await core.clearHistory();
  });

  ipcMain.handle(OPEN_EXTERNAL_CHANNEL, (_event, url: unknown) => {
    if (typeof url !== 'string' || !isWebUrl(url)) {
      return;
    }
    return shell.openExternal(url);
  });

  ipcMain.handle(COPY_TEXT_CHANNEL, (_event, text: unknown) => {
    if (typeof text !== 'string') {
      return;
    }
    clipboard.writeText(text);
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
