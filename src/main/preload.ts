import { contextBridge, ipcRenderer } from 'electron';
import type { TishkaEvent } from '../core/types';
import { EVENT_CHANNEL, USER_TEXT_CHANNEL } from './ipc-channels';

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
  }
};

contextBridge.exposeInMainWorld('tishka', api);

export type TishkaApi = typeof api;
