import { contextBridge, ipcRenderer } from 'electron';
import type { ConnectionDraft } from '../core/connections';
import type { HistoryEntry } from '../core/history';
import type { McpStatus } from '../core/mcp/manager';
import type { Config, TishkaEvent } from '../core/types';
import type { PetModel } from '../pet/state';
import type {
  ConfigView,
  ConnectionPlanResult,
  ConnectionSaveResult,
  ConnectionView
} from './ipc-settings';
import {
  CONFIG_CHANGED_CHANNEL,
  CONFIG_GET_CHANNEL,
  CONFIG_SAVE_CHANNEL,
  CONNECTIONS_PLAN_CHANNEL,
  CONNECTIONS_RECONNECT_CHANNEL,
  CONNECTIONS_REMOVE_CHANNEL,
  CONNECTIONS_SAVE_CHANNEL,
  CONNECTIONS_STATUS_CHANNEL,
  COPY_TEXT_CHANNEL,
  EVENT_CHANNEL,
  HISTORY_CHANNEL,
  HISTORY_CLEAR_CHANNEL,
  OPEN_CHAT_CHANNEL,
  OPEN_EXTERNAL_CHANNEL,
  OPEN_SETTINGS_CHANNEL,
  PET_BUSY_CHANNEL,
  PET_DRAG_CHANNEL,
  PET_DRAG_END_CHANNEL,
  PET_INTERACTIVE_CHANNEL,
  PET_MODEL_CHANNEL,
  PET_WAKE_CHANNEL,
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
  },
  config: {
    get(): Promise<ConfigView> {
      return ipcRenderer.invoke(CONFIG_GET_CHANNEL);
    },
    save(config: Config): Promise<void> {
      return ipcRenderer.invoke(CONFIG_SAVE_CHANNEL, config);
    },
    onChanged(listener: () => void): () => void {
      const handler = (): void => {
        listener();
      };
      ipcRenderer.on(CONFIG_CHANGED_CHANNEL, handler);
      return () => {
        ipcRenderer.removeListener(CONFIG_CHANGED_CHANNEL, handler);
      };
    }
  },
  connections: {
    plan(draft: ConnectionDraft): Promise<ConnectionPlanResult> {
      return ipcRenderer.invoke(CONNECTIONS_PLAN_CHANNEL, draft);
    },
    save(draft: ConnectionDraft, previousName?: string): Promise<ConnectionSaveResult> {
      return ipcRenderer.invoke(CONNECTIONS_SAVE_CHANNEL, draft, previousName);
    },
    remove(name: string): Promise<void> {
      return ipcRenderer.invoke(CONNECTIONS_REMOVE_CHANNEL, name);
    },
    status(): Promise<ConnectionView[]> {
      return ipcRenderer.invoke(CONNECTIONS_STATUS_CHANNEL);
    },
    reconnect(name: string): Promise<McpStatus | undefined> {
      return ipcRenderer.invoke(CONNECTIONS_RECONNECT_CHANNEL, name);
    }
  },
  openSettings(): Promise<void> {
    return ipcRenderer.invoke(OPEN_SETTINGS_CHANNEL);
  },
  openChat(): Promise<void> {
    return ipcRenderer.invoke(OPEN_CHAT_CHANNEL);
  },
  onPetModel(listener: (model: PetModel) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, model: PetModel): void => {
      listener(model);
    };
    ipcRenderer.on(PET_MODEL_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(PET_MODEL_CHANNEL, handler);
    };
  },
  pet: {
    setInteractive(interactive: boolean): void {
      ipcRenderer.send(PET_INTERACTIVE_CHANNEL, interactive);
    },
    setBusy(busy: boolean): void {
      ipcRenderer.send(PET_BUSY_CHANNEL, busy);
    },
    dragBy(deltaX: number): void {
      ipcRenderer.send(PET_DRAG_CHANNEL, deltaX);
    },
    dragEnd(): void {
      ipcRenderer.send(PET_DRAG_END_CHANNEL);
    },
    wake(source: 'name' | 'hotkey' | 'click' | 'trigger'): void {
      ipcRenderer.send(PET_WAKE_CHANNEL, source);
    }
  }
};

contextBridge.exposeInMainWorld('tishka', api);

export type TishkaApi = typeof api;
