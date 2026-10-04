import type { EventBus } from '../../src/core/types';
import type { PetLayout } from '../../src/pet/layout';
import {
  PET_LISTEN_COMMAND_CHANNEL,
  PET_SPEAK_CHANNEL,
  PET_SPEAK_STOP_CHANNEL,
  PET_WAKE_STATE_CHANNEL
} from '../../src/main/ipc-channels';
import type { PetActivation } from '../../src/main/pet-activation';
import type { PetWindow } from '../../src/main/pet-window-types';
import type { WindowEdge } from './window-edge';

interface LifecycleLike {
  setBusy(value: boolean): void;
  leave(): void;
  isVisible(): boolean;
  dispose(): void;
}

export interface PetFacadeDeps {
  bus: EventBus;
  lifecycle: LifecycleLike;
  win: WindowEdge;
  layout: PetLayout;
  activation: PetActivation;
}

// Окно-питомец, каким его видят соседи: те же правила вызова, показа и ухода,
// что в createPetWindow, но окно подставное.
export function createPetFacade(deps: PetFacadeDeps): PetWindow {
  const { bus, win, activation } = deps;
  const browserWindow = win.browserWindow;
  const lifecycle = deps.lifecycle;
  return {
    wake(source): void {
      bus.emit({ type: 'wake', source });
      if (source === 'hotkey' || source === 'click') {
        activation.focus();
      }
    },
    setInteractive(value): void {
      browserWindow.setIgnoreMouseEvents(!value, { forward: true });
    },
    setBusy(value): void {
      lifecycle.setBusy(value);
    },
    focusWindow(): void {
      if (!lifecycle.isVisible()) {
        browserWindow.setBounds(deps.layout.window);
        browserWindow.showInactive();
      }
      activation.focus();
    },
    dragBy(): void {},
    dragEnd(): void {},
    listenCommand(command): void {
      browserWindow.webContents.send(PET_LISTEN_COMMAND_CHANNEL, command);
    },
    wakeState(state): void {
      browserWindow.webContents.send(PET_WAKE_STATE_CHANNEL, state);
    },
    speak(message): void {
      browserWindow.webContents.send(PET_SPEAK_CHANNEL, message);
    },
    stopSpeaking(): void {
      browserWindow.webContents.send(PET_SPEAK_STOP_CHANNEL);
    },
    hide(): void {
      browserWindow.hide();
    },
    show(): void {
      browserWindow.setBounds(deps.layout.window);
      browserWindow.showInactive();
      activation.sendPointer();
    },
    leave(): void {
      lifecycle.leave();
    },
    isVisible(): boolean {
      return lifecycle.isVisible();
    },
    reload(): void {},
    onPageLoaded(): void {},
    dispose(): void {
      lifecycle.dispose();
    }
  };
}
