import { contextBridge, ipcRenderer } from 'electron';
import type { HistoryEntry } from '../core/history';
import type { TishkaEvent } from '../core/types';
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

const api = {
  onEvent(listener: (event: TishkaEvent) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, event: TishkaEvent): void => {
      listener(event);
    };
    ipcRenderer.on(EVENT_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(EVENT_CHANNEL, handler);
    };
  },
  sendUserText(text: string): void {
    ipcRenderer.send(USER_TEXT_CHANNEL, text);
  },
  history(limit?: number): Promise<HistoryEntry[]> {
    return ipcRenderer.invoke(HISTORY_CHANNEL, limit);
  },
  clearHistory(): Promise<void> {
    return ipcRenderer.invoke(HISTORY_CLEAR_CHANNEL);
  },
  openExternal(url: string): Promise<void> {
    return ipcRenderer.invoke(OPEN_EXTERNAL_CHANNEL, url);
  },
  copyText(text: string): Promise<void> {
    return ipcRenderer.invoke(COPY_TEXT_CHANNEL, text);
  },
  secrets: {
    set(name: string, value: string): Promise<void> {
      return ipcRenderer.invoke(SECRETS_SET_CHANNEL, name, value);
    },
    has(name: string): Promise<boolean> {
      return ipcRenderer.invoke(SECRETS_HAS_CHANNEL, name);
    },
    delete(name: string): Promise<void> {
      return ipcRenderer.invoke(SECRETS_DELETE_CHANNEL, name);
    },
    names(): Promise<string[]> {
      return ipcRenderer.invoke(SECRETS_NAMES_CHANNEL);
    }
  }
};

contextBridge.exposeInMainWorld('tishka', api);

export type TishkaApi = typeof api;
