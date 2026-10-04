import { ipcMain } from 'electron';
import type { Config, EventBus } from '../core/types';
import type { WakeFlow } from '../voice/wake-flow';
import type { PetWindow } from './pet-window';
import {
  PET_CONVERSATION_TOGGLE_CHANNEL,
  PET_WAKE_ERROR_CHANNEL,
  PET_WAKE_ESCAPE_CHANNEL,
  PET_WAKE_PHRASE_CHANNEL
} from './ipc-channels';

const BUSY = new Set(['think.start', 'tool.start', 'reply', 'speak.start', 'listen.start']);

export interface PetWakeDeps {
  pet: PetWindow;
  flow: WakeFlow;
  bus: EventBus;
  getVoice(): Config['voice'];
  isReady(): boolean;
}

export interface PetWake {
  broadcast(): void;
  isListening(): boolean;
  dispose(): void;
}

// Связка постоянного прослушивания с окном-питомцем: фразы, режим разговора, пауза.
export function registerPetWake(deps: PetWakeDeps): PetWake {
  let busy = false;
  let listening = false;

  function broadcast(): void {
    const voice = deps.getVoice();
    // Режимом владеет одно окно: пока разговор ведёт чат, питомец не слушает.
    const mine = deps.flow.conversationOwner() === 'pet';
    const idle = deps.flow.conversationOwner() === null;
    listening = !busy && deps.isReady() && (idle ? voice.wakeEnabled : mine);
    deps.pet.wakeState({
      active: listening,
      conversation: mine,
      soon: mine && deps.flow.isLeavingSoon(),
      sensitivity: voice.sensitivity
    });
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

  return { broadcast, isListening: () => listening, dispose: unsubscribe };
}
