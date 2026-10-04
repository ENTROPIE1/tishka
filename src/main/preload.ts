import { contextBridge, ipcRenderer } from 'electron';
import type { ConnectionDraft } from '../core/connections';
import type { HistoryEntry } from '../core/history';
import type { McpStatus } from '../core/mcp/manager';
import type { MemoryRecord, UpdateMemoryPatch } from '../core/memory/store';
import type { Config, TishkaEvent } from '../core/types';
import type { PetModel } from '../pet/state';
import type { ListenCommand, ListenResult } from '../voice/listen';
import type { ChatTalkState, WakeState } from '../voice/wake';
import type { SpeakMessage } from '../voice/speech-queue';
import type { TtsHealth } from '../voice/tts-client';
import type { TranscribeResult } from '../voice/stt-service';
import type {
  ConfigView,
  ConnectionPlanResult,
  ConnectionSaveResult,
  ConnectionView,
  VoiceStateView
} from './ipc-settings';
import {
  CHAT_TALK_ESCAPE_CHANNEL,
  CHAT_TALK_KEYBOARD_CHANNEL,
  CHAT_TALK_PHRASE_CHANNEL,
  CHAT_TALK_STATE_CHANNEL,
  CHAT_TALK_TOGGLE_CHANNEL,
  CONFIG_CHANGED_CHANNEL,
  CONFIG_GET_CHANNEL,
  CONFIG_SAVE_CHANNEL,
  CONNECTIONS_PLAN_CHANNEL,
  CONNECTIONS_RECONNECT_CHANNEL,
  CONNECTIONS_REMOVE_CHANNEL,
  CONNECTIONS_SAVE_CHANNEL,
  CONNECTIONS_STATUS_CHANNEL,
  COPY_IMAGE_CHANNEL,
  COPY_RICH_CHANNEL,
  COPY_TEXT_CHANNEL,
  EVENT_CHANNEL,
  OPEN_IMAGE_CHANNEL,
  HISTORY_CHANNEL,
  HISTORY_CLEAR_CHANNEL,
  HISTORY_SEARCH_CHANNEL,
  MEMORY_CLEAR_CHANNEL,
  MEMORY_LIST_CHANNEL,
  MEMORY_REMOVE_CHANNEL,
  MEMORY_SEARCH_CHANNEL,
  MEMORY_UPDATE_CHANNEL,
  NAVIGATE_CHANNEL,
  NEW_CONVERSATION_CHANNEL,
  OPEN_CHAT_CHANNEL,
  OPEN_EXTERNAL_CHANNEL,
  OPEN_SETTINGS_CHANNEL,
  PET_BUSY_CHANNEL,
  PET_DRAG_CHANNEL,
  PET_DRAG_END_CHANNEL,
  PET_FOCUS_CHANNEL,
  PET_INTERACTIVE_CHANNEL,
  PET_LISTEN_COMMAND_CHANNEL,
  PET_LISTEN_RESULT_CHANNEL,
  PET_LISTEN_TOGGLE_CHANNEL,
  PET_MODEL_CHANNEL,
  PET_WAKE_CHANNEL,
  PET_CONVERSATION_TOGGLE_CHANNEL,
  PET_WAKE_ERROR_CHANNEL,
  PET_WAKE_ESCAPE_CHANNEL,
  PET_WAKE_PHRASE_CHANNEL,
  PET_WAKE_STATE_CHANNEL,
  PET_SPEAK_CHANNEL,
  PET_SPEAK_STOP_CHANNEL,
  PET_SPEAK_DONE_CHANNEL,
  SECRETS_DELETE_CHANNEL,
  SECRETS_HAS_CHANNEL,
  SECRETS_NAMES_CHANNEL,
  SECRETS_SET_CHANNEL,
  USER_TEXT_CHANNEL,
  VOICE_APPLY_CHANNEL,
  VOICE_CHECK_CHANNEL,
  VOICE_DICTATE_CHANNEL,
  VOICE_STATUS_CHANNEL,
  SPEECH_HEALTH_CHANNEL,
  SPEECH_SAY_CHANNEL
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
  historySearch(query: string, limit?: number): Promise<HistoryEntry[]> {
    return ipcRenderer.invoke(HISTORY_SEARCH_CHANNEL, query, limit);
  },
  newConversation(): Promise<void> {
    return ipcRenderer.invoke(NEW_CONVERSATION_CHANNEL);
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
  copyRich(html: string, text: string): Promise<void> {
    return ipcRenderer.invoke(COPY_RICH_CHANNEL, html, text);
  },
  copyImage(path: string): Promise<void> {
    return ipcRenderer.invoke(COPY_IMAGE_CHANNEL, path);
  },
  openImage(path: string): Promise<void> {
    return ipcRenderer.invoke(OPEN_IMAGE_CHANNEL, path);
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
  onNavigate(listener: (screen: string) => void): () => void {
    const handler = (_event: Electron.IpcRendererEvent, screen: string): void => {
      listener(screen);
    };
    ipcRenderer.on(NAVIGATE_CHANNEL, handler);
    return () => {
      ipcRenderer.removeListener(NAVIGATE_CHANNEL, handler);
    };
  },
  memory: {
    list: (): Promise<MemoryRecord[]> => ipcRenderer.invoke(MEMORY_LIST_CHANNEL),
    search: (query: string): Promise<MemoryRecord[]> => ipcRenderer.invoke(MEMORY_SEARCH_CHANNEL, query),
    update: (id: string, patch: UpdateMemoryPatch): Promise<MemoryRecord | undefined> =>
      ipcRenderer.invoke(MEMORY_UPDATE_CHANNEL, { id, ...patch }),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke(MEMORY_REMOVE_CHANNEL, id),
    clear: (): Promise<void> => ipcRenderer.invoke(MEMORY_CLEAR_CHANNEL)
  },
  openChat(): Promise<void> {
    return ipcRenderer.invoke(OPEN_CHAT_CHANNEL);
  },
  chatTalk: {
    toggle(): void {
      ipcRenderer.send(CHAT_TALK_TOGGLE_CHANNEL);
    },
    phrase(wav: Uint8Array): void {
      ipcRenderer.send(CHAT_TALK_PHRASE_CHANNEL, wav);
    },
    escape(): void {
      ipcRenderer.send(CHAT_TALK_ESCAPE_CHANNEL);
    },
    keyboard(): void {
      ipcRenderer.send(CHAT_TALK_KEYBOARD_CHANNEL);
    },
    onState(listener: (state: ChatTalkState) => void): () => void {
      const handler = (_event: Electron.IpcRendererEvent, state: ChatTalkState): void => {
        listener(state);
      };
      ipcRenderer.on(CHAT_TALK_STATE_CHANNEL, handler);
      return () => {
        ipcRenderer.removeListener(CHAT_TALK_STATE_CHANNEL, handler);
      };
    }
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
    },
    focus(): void {
      ipcRenderer.send(PET_FOCUS_CHANNEL);
    },
    listenToggle(): void {
      ipcRenderer.send(PET_LISTEN_TOGGLE_CHANNEL);
    },
    listenResult(result: ListenResult): void {
      ipcRenderer.send(PET_LISTEN_RESULT_CHANNEL, result);
    },
    wakePhrase(wav: Uint8Array): void {
      ipcRenderer.send(PET_WAKE_PHRASE_CHANNEL, wav);
    },
    conversationToggle(): void {
      ipcRenderer.send(PET_CONVERSATION_TOGGLE_CHANNEL);
    },
    wakeEscape(): void {
      ipcRenderer.send(PET_WAKE_ESCAPE_CHANNEL);
    },
    wakeError(message: string): void {
      ipcRenderer.send(PET_WAKE_ERROR_CHANNEL, message);
    },
    speakDone(): void {
      ipcRenderer.send(PET_SPEAK_DONE_CHANNEL);
    },
    onSpeak(listener: (message: SpeakMessage) => void): () => void {
      const handler = (_event: Electron.IpcRendererEvent, message: SpeakMessage): void => {
        listener(message);
      };
      ipcRenderer.on(PET_SPEAK_CHANNEL, handler);
      return () => {
        ipcRenderer.removeListener(PET_SPEAK_CHANNEL, handler);
      };
    },
    onSpeakStop(listener: () => void): () => void {
      const handler = (): void => {
        listener();
      };
      ipcRenderer.on(PET_SPEAK_STOP_CHANNEL, handler);
      return () => {
        ipcRenderer.removeListener(PET_SPEAK_STOP_CHANNEL, handler);
      };
    },
    onWakeState(listener: (state: WakeState) => void): () => void {
      const handler = (_event: Electron.IpcRendererEvent, state: WakeState): void => {
        listener(state);
      };
      ipcRenderer.on(PET_WAKE_STATE_CHANNEL, handler);
      return () => {
        ipcRenderer.removeListener(PET_WAKE_STATE_CHANNEL, handler);
      };
    },
    onListenCommand(listener: (command: ListenCommand) => void): () => void {
      const handler = (_event: Electron.IpcRendererEvent, command: ListenCommand): void => {
        listener(command);
      };
      ipcRenderer.on(PET_LISTEN_COMMAND_CHANNEL, handler);
      return () => {
        ipcRenderer.removeListener(PET_LISTEN_COMMAND_CHANNEL, handler);
      };
    }
  },
  voice: {
    status(): Promise<VoiceStateView> {
      return ipcRenderer.invoke(VOICE_STATUS_CHANNEL);
    },
    check(): Promise<VoiceStateView> {
      return ipcRenderer.invoke(VOICE_CHECK_CHANNEL);
    },
    apply(hotkey: string): Promise<void> {
      return ipcRenderer.invoke(VOICE_APPLY_CHANNEL, hotkey);
    },
    dictate(wav: Uint8Array): Promise<TranscribeResult> {
      return ipcRenderer.invoke(VOICE_DICTATE_CHANNEL, wav);
    }
  },
  speech: {
    health(): Promise<TtsHealth> {
      return ipcRenderer.invoke(SPEECH_HEALTH_CHANNEL);
    },
    say(): Promise<void> {
      return ipcRenderer.invoke(SPEECH_SAY_CHANNEL);
    }
  }
};

contextBridge.exposeInMainWorld('tishka', api);

export type TishkaApi = typeof api;
