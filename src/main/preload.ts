import { contextBridge, ipcRenderer } from 'electron';
import type { TishkaEvent } from '../core/types';
import {
  EVENT_CHANNEL,
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
