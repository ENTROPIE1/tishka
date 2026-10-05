import type { BrowserWindow } from 'electron';
import type { PetModel } from '../../src/pet/state';
import type { TishkaEvent } from '../../src/core/types';
import type { ListenCommand } from '../../src/voice/listen';
import type { WakeState } from '../../src/voice/wake';
import type { SpeakMessage } from '../../src/voice/speech-queue';
import {
  EVENT_CHANNEL,
  PET_FOCUS_INPUT_CHANNEL,
  PET_LISTEN_COMMAND_CHANNEL,
  PET_MODEL_CHANNEL,
  PET_POINTER_CHANNEL,
  PET_SPEAK_CHANNEL,
  PET_SPEAK_STOP_CHANNEL,
  PET_WAKE_STATE_CHANNEL
} from '../../src/main/ipc-channels';
import { createPage, type Page, type PageDeps } from './page';

export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Рабочая область и место окна те же на весь сценарий: появление всегда на месте.
export const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1040 };

export interface WindowEdge {
  browserWindow: BrowserWindow;
  page: Page;
  ignoreMouse(): boolean;
  bounds(): WindowRect;
}

// Окно Electron: показ, скрытие, интерактивность и доставка сообщений странице.
export function createWindowEdge(deps: PageDeps): WindowEdge {
  const page = createPage(deps);
  let visible = false;
  let ignoreMouse = true;
  let bounds: WindowRect = { x: 0, y: 0, width: 0, height: 0 };

  function deliver(channel: string, payload: unknown): void {
    if (channel === PET_MODEL_CHANNEL) {
      page.model(payload as PetModel);
    } else if (channel === PET_WAKE_STATE_CHANNEL) {
      page.wakeState(payload as WakeState);
    } else if (channel === PET_LISTEN_COMMAND_CHANNEL) {
      page.listenCommand(payload as ListenCommand);
    } else if (channel === PET_SPEAK_CHANNEL) {
      page.speak(payload as SpeakMessage);
    } else if (channel === PET_SPEAK_STOP_CHANNEL) {
      page.stopSpeak();
    } else if (channel === PET_POINTER_CHANNEL) {
      page.pointer();
    } else if (channel === PET_FOCUS_INPUT_CHANNEL) {
      page.focusComposer();
    } else if (channel === EVENT_CHANNEL) {
      page.event(payload as TishkaEvent);
    }
  }

  const browserWindow = {
    isDestroyed: () => false,
    isVisible: () => visible,
    showInactive: () => {
      visible = true;
      page.setVisible(true);
    },
    hide: () => {
      visible = false;
      page.setVisible(false);
    },
    setBounds: (rect: WindowRect) => {
      bounds = rect;
    },
    getBounds: () => bounds,
    focus: () => undefined,
    setIgnoreMouseEvents: (value: boolean) => {
      ignoreMouse = value;
    },
    webContents: {
      send: (channel: string, payload?: unknown) => deliver(channel, payload),
      on: () => undefined
    }
  };

  return {
    browserWindow: browserWindow as unknown as BrowserWindow,
    page,
    ignoreMouse: () => ignoreMouse,
    bounds: () => bounds
  };
}
