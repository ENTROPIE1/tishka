import { readFile } from 'node:fs/promises';
import { BrowserWindow, clipboard, ClipboardItem, ipcMain, shell } from 'electron';
import type { TishkaCore } from '../core/app';
import type { SecretStore, TishkaEvent } from '../core/types';
import { isMainWindow } from './chat-window';
import type { SourceBus } from './source-bus';
import {
  CANCEL_CHANNEL,
  CONFIRM_CHANNEL,
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
  STATS_SUMMARY_CHANNEL,
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

export function registerIpc(
  bus: SourceBus,
  core: TishkaCore,
  secrets: SecretStore,
  onUserText?: () => void,
  onCancel?: () => void
): void {
  bus.on(broadcastEvent);

  ipcMain.on(USER_TEXT_CHANNEL, (event, text: unknown) => {
    if (typeof text !== 'string') {
      return;
    }
    const trimmed = text.trim();
    if (trimmed === '') {
      return;
    }
    // Набранный текст отменяет идущую разовую запись: она завершилась бы
    // пустой и сообщила «Не расслышал» посреди ответа.
    onUserText?.();
    // Реплика из чата, пока окно в фокусе, не будит ежа: ответ виден в чате.
    const window = BrowserWindow.fromWebContents(event.sender);
    const source = window !== null && isMainWindow(window) && window.isFocused() ? 'chat' : 'pet';
    void bus.run(source, () => core.handleUserText(trimmed, 'text')).catch(() => undefined);
  });

  // Остановка доступна любому окну: чат и окно ежа используют один канал.
  // Источник решает, как окна показывают служебную строку об остановке.
  ipcMain.on(CANCEL_CHANNEL, (event) => {
    const sender = BrowserWindow.fromWebContents(event.sender);
    core.cancel(sender !== null && isMainWindow(sender) ? 'chat' : 'pet');
    onCancel?.();
  });

  // Ответ на вопрос подтверждения из любого окна: «да» выполняет инструмент,
  // «нет» возвращает отказ. Неизвестный вопрос ядро просто игнорирует.
  ipcMain.on(CONFIRM_CHANNEL, (_event, id: unknown, yes: unknown) => {
    if (typeof id !== 'string' || typeof yes !== 'boolean') {
      return;
    }
    core.confirm(id, yes);
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

  ipcMain.handle(STATS_SUMMARY_CHANNEL, () => core.statsSummary());

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
