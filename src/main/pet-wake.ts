import { ipcMain } from 'electron';
import type { Config, EventBus } from '../core/types';
import type { WakeFlow } from '../voice/wake-flow';
import { DEFAULT_WARM_MINUTES, keepMicOpen } from '../voice/warm';
import type { PetWindow } from './pet-window';
import {
  PET_CONVERSATION_TOGGLE_CHANNEL,
  PET_WAKE_ERROR_CHANNEL,
  PET_WAKE_ESCAPE_CHANNEL,
  PET_WAKE_PHRASE_CHANNEL
} from './ipc-channels';

const BUSY = new Set(['think.start', 'tool.start', 'reply', 'speak.start', 'listen.start']);
// Обращения человека: продлевают тёплое состояние микрофона.
const ACTIVITY = new Set([
  'wake',
  'listen.start',
  'listen.end',
  'think.start',
  'tool.start',
  'tool.end',
  'reply',
  'speak.start'
]);
const WARM_TICK_MS = 15000;

export interface PetWakeDeps {
  pet: PetWindow;
  flow: WakeFlow;
  bus: EventBus;
  getVoice(): Config['voice'];
  getWarmMinutes?: () => number;
  isReady(): boolean;
}

export interface PetWake {
  broadcast(): void;
  setPaused(value: boolean): void;
  isListening(): boolean;
  dispose(): void;
}

// Связка постоянного прослушивания с окном-питомцем: фразы, режим разговора, пауза.
export function registerPetWake(deps: PetWakeDeps): PetWake {
  let busy = false;
  let paused = false;
  let listening = false;
  let lastInteractionAt = Date.now();

  function broadcast(): void {
    const voice = deps.getVoice();
    // Режимом владеет одно окно: пока разговор ведёт чат, питомец не слушает.
    const mine = deps.flow.conversationOwner() === 'pet';
    const idle = deps.flow.conversationOwner() === null;
    const warm = idle && keepMicOpen({
      ready: deps.isReady(),
      wakeEnabled: voice.wakeEnabled,
      ownerActive: false,
      lastInteractionAt,
      now: Date.now(),
      warmMinutes: deps.getWarmMinutes?.() ?? DEFAULT_WARM_MINUTES
    });
    listening = !paused && !busy && deps.isReady() && (mine || warm);
    deps.pet.wakeState({
      active: listening,
      conversation: mine,
      soon: mine && deps.flow.isLeavingSoon(),
      waiting: deps.flow.isWaiting?.() ?? false,
      sensitivity: voice.sensitivity,
      threshold: voice.mic.threshold
    });
  }

  const unsubscribe = deps.bus.on((event) => {
    if (ACTIVITY.has(event.type)) {
      lastInteractionAt = Date.now();
    }
    if (BUSY.has(event.type)) {
      busy = true;
    } else if (event.type === 'idle' || event.type === 'speak.end') {
      busy = false;
    } else {
      return;
    }
    broadcast();
  });

  // Долгий простой: когда тёплое время истекло, микрофон закрывается сам.
  const warmTimer = setInterval(broadcast, WARM_TICK_MS);
  warmTimer.unref?.();

  ipcMain.on(PET_WAKE_PHRASE_CHANNEL, (_event, value: unknown) => {
    if (value instanceof Uint8Array) {
      deps.flow.handlePhrase(value);
    } else if (value instanceof ArrayBuffer) {
      deps.flow.handlePhrase(new Uint8Array(value));
    }
  });

  ipcMain.on(PET_CONVERSATION_TOGGLE_CHANNEL, () => {
    deps.flow.toggleConversation();
    broadcast();
  });

  ipcMain.on(PET_WAKE_ESCAPE_CHANNEL, () => {
    deps.flow.escape();
    broadcast();
  });

  ipcMain.on(PET_WAKE_ERROR_CHANNEL, (_event, message: unknown) => {
    if (typeof message === 'string' && message !== '') {
      deps.flow.reportError(message);
    }
  });

  return {
    broadcast,
    setPaused(value: boolean): void {
      paused = value;
      broadcast();
    },
    isListening: () => listening,
    dispose(): void {
      clearInterval(warmTimer);
      unsubscribe();
    }
  };
}
