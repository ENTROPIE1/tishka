import { readFile } from 'node:fs/promises';
import { BrowserWindow, clipboard, ClipboardItem, ipcMain, shell } from 'electron';
import type { TishkaCore } from '../core/app';
import type { EventBus, SecretStore, TishkaEvent } from '../core/types';
import {
  CONFIG_CHANGED_CHANNEL,
  COPY_IMAGE_CHANNEL,
  COPY_RICH_CHANNEL,
  COPY_TEXT_CHANNEL,
  EVENT_CHANNEL,
  OPEN_IMAGE_CHANNEL,
  HISTORY_CHANNEL,
  HISTORY_CLEAR_CHANNEL,
  HISTORY_SEARCH_CHANNEL,
  NEW_CONVERSATION_CHANNEL,
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

// Сообщает окнам, что настройки или секреты изменились: они перечитывают состояние.
export function broadcastConfigChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(CONFIG_CHANGED_CHANNEL);
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

  ipcMain.handle(HISTORY_SEARCH_CHANNEL, (_event, query: unknown, limit: unknown) => {
    if (typeof query !== 'string' || query.trim() === '') {
      return [];
    }
    return core.historySearch(query, typeof limit === 'number' ? limit : undefined);
  });

  ipcMain.handle(HISTORY_CLEAR_CHANNEL, async () => {
    await core.clearHistory();
  });

  ipcMain.handle(NEW_CONVERSATION_CHANNEL, () => {
    core.newConversation();
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

  // Копирование с форматированием: сразу html (для Word, Outlook, Confluence) и текст.
  ipcMain.handle(COPY_RICH_CHANNEL, (_event, html: unknown, text: unknown) => {
    if (typeof html !== 'string' || typeof text !== 'string') {
      return;
    }
    return clipboard.write([new ClipboardItem({ 'text/html': html, 'text/plain': text })]);
  });

  // Карточка-картинка: в буфер кладётся сама картинка, а не путь к файлу.
  ipcMain.handle(COPY_IMAGE_CHANNEL, async (_event, path: unknown) => {
    if (typeof path !== 'string' || path === '') {
      return;
    }
    const bytes = await readFile(path);
    await clipboard.write([
      new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) })
    ]);
  });

  // Щелчок по картинке открывает её в программе просмотра файлов.
  ipcMain.handle(OPEN_IMAGE_CHANNEL, (_event, path: unknown) => {
    if (typeof path !== 'string' || path === '') {
      return;
    }
    return shell.openPath(path);
  });

  ipcMain.handle(SECRETS_SET_CHANNEL, async (_event, name: unknown, value: unknown) => {
    if (typeof name !== 'string' || typeof value !== 'string') {
      return;
    }
    await secrets.set(name, value);
    broadcastConfigChanged();
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
    broadcastConfigChanged();
  });

  ipcMain.handle(SECRETS_NAMES_CHANNEL, async (): Promise<string[]> => {
    return secrets.names();
  });
}
