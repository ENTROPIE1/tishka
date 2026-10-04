import { BrowserWindow, ipcMain } from 'electron';
import type { Config, EventBus } from '../core/types';
import type { ChatTalkState } from '../voice/wake';
import type { WakeFlow } from '../voice/wake-flow';
import {
  CHAT_TALK_ESCAPE_CHANNEL,
  CHAT_TALK_KEYBOARD_CHANNEL,
  CHAT_TALK_PHRASE_CHANNEL,
  CHAT_TALK_STATE_CHANNEL,
  CHAT_TALK_TOGGLE_CHANNEL
} from './ipc-channels';

const BUSY = new Set(['think.start', 'tool.start', 'reply', 'speak.start', 'listen.start']);

export interface ChatTalkDeps {
  flow: WakeFlow;
  bus: EventBus;
  getVoice(): Config['voice'];
  isReady(): boolean;
  onChange?(): void;
}

export interface ChatTalk {
  broadcast(): void;
  setPaused(value: boolean): void;
  dispose(): void;
}

function bytes(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return undefined;
}

// Режим разговора в окне чата: та же wake-flow, что и у питомца, но владелец —
// чат. Состояние уходит в окна, а фразы и нажатия — в общий поток.
export function registerChatTalk(deps: ChatTalkDeps): ChatTalk {
  let busy = false;
  let paused = false;

  function state(): ChatTalkState {
    const voice = deps.getVoice();
    const mine = deps.flow.conversationOwner() === 'chat';
    return {
      active: !paused && !busy && deps.isReady() && mine,
      conversation: mine,
      soon: mine && deps.flow.isLeavingSoon(),
      sensitivity: voice.sensitivity,
      threshold: voice.mic.threshold
    };
  }

  function broadcast(): void {
    const payload = state();
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(CHAT_TALK_STATE_CHANNEL, payload);
    }
  }

  const unsubscribe = deps.bus.on((event) => {
    if (BUSY.has(event.type)) {
      busy = true;
    } else if (event.type === 'idle' || event.type === 'speak.end') {
      busy = false;
    } else {
      return;
    }
    broadcast();
  });

  ipcMain.on(CHAT_TALK_TOGGLE_CHANNEL, () => {
    deps.flow.toggleConversation('chat');
    broadcast();
    deps.onChange?.();
  });

  ipcMain.on(CHAT_TALK_PHRASE_CHANNEL, (_event, value: unknown) => {
    const data = bytes(value);
    if (data !== undefined) {
      deps.flow.handlePhrase(data);
    }
  });

  ipcMain.on(CHAT_TALK_ESCAPE_CHANNEL, () => {
    deps.flow.escape();
    broadcast();
    deps.onChange?.();
  });

  ipcMain.on(CHAT_TALK_KEYBOARD_CHANNEL, () => {
    deps.flow.onKeyboardInput();
  });

  return {
    broadcast,
    setPaused(value: boolean): void {
      paused = value;
      broadcast();
    },
    dispose: unsubscribe
  };
}
