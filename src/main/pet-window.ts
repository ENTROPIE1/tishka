import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import type { Config, EventBus } from '../core/types';
import type { ListenCommand } from '../voice/listen';
import type { WakeState } from '../voice/wake';
import type { SpeakMessage } from '../voice/speech-queue';
import { PET_LISTEN_COMMAND_CHANNEL, PET_SPEAK_CHANNEL, PET_SPEAK_STOP_CHANNEL, PET_WAKE_STATE_CHANNEL } from './ipc-channels';
import { guardNavigation } from './navigation-guard';
import { createPetLifecycle, type PetLifecycle } from './pet-lifecycle';
import { Mover } from './pet-motion';
import { PetPlacement } from './pet-placement';

export interface PetWindowDeps {
  bus: EventBus;
  getConfig: () => Config;
  savePetX: (x: number | null) => Promise<void>;
  onReload?: () => void;
}

export interface PetWindow {
  wake(source: 'name' | 'hotkey' | 'click' | 'trigger'): void;
  setInteractive(interactive: boolean): void;
  setBusy(busy: boolean): void;
  focusWindow(): void;
  dragBy(deltaX: number): void;
  dragEnd(): void;
  listenCommand(command: ListenCommand): void;
  wakeState(state: WakeState): void;
  speak(message: SpeakMessage): void;
  stopSpeaking(): void;
  hide(): void;
  show(): void;
  leave(): void;
  reload(): void;
  dispose(): void;
}

export function createPetWindow(deps: PetWindowDeps): PetWindow {
  const placement = new PetPlacement(deps.getConfig().pet.x, {});
  const window = new BrowserWindow({
    ...placement.bounds(), x: placement.geometry.hiddenX,
    show: false, frame: false, transparent: true, resizable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false
    }
  });
  window.setMenu(null);
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setIgnoreMouseEvents(true, { forward: true });
  guardNavigation(window);

  // Запись с микрофона: разрешаем только доступ к медиа, остальное запрещено.
  window.webContents.session.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === 'media');
  });
  window.webContents.session.setPermissionCheckHandler((_contents, permission) => permission === 'media');
  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (rendererUrl !== undefined) {
    void window.loadURL(`${rendererUrl}/pet/index.html`);
  } else {
    void window.loadFile(join(__dirname, '../renderer/pet/index.html'));
  }

  const mover = new Mover(window, placement.geometry);
  const lifecycle: PetLifecycle = createPetLifecycle({ window, mover, placement, bus: deps.bus, getConfig: deps.getConfig });

  function send(channel: string, payload?: unknown): void {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }

  function showAtRest(): void {
    placement.ensureOnScreen();
    window.setBounds(placement.bounds());
    window.showInactive();
  }

  return {
    wake(source): void {
      // Фокус окна забирают только вызов по клавише и щелчок.
      const focus = source === 'hotkey' || source === 'click';
      deps.bus.emit({ type: 'wake', source });
      if (focus && !window.isDestroyed() && window.isVisible()) {
        window.focus();
      }
    },
    setInteractive(value): void {
      window.setIgnoreMouseEvents(!value, { forward: true });
    },
    setBusy(value): void {
      lifecycle.setBusy(value);
    },
    focusWindow(): void {
      if (window.isDestroyed()) return;
      if (!window.isVisible()) showAtRest();
      window.focus();
    },
    dragBy(deltaX): void {
      if (window.isDestroyed()) return;
      // Двигаем ёжика по экрану; окно и сторона раскладки следуют за ним.
      placement.dragBy(deltaX);
      window.setBounds(placement.bounds());
      lifecycle.sendLayout();
    },
    dragEnd(): void {
      void deps.savePetX(placement.layout.petX);
    },
    listenCommand(command): void {
      send(PET_LISTEN_COMMAND_CHANNEL, command);
    },
    wakeState(state): void {
      send(PET_WAKE_STATE_CHANNEL, state);
    },
    speak(message): void {
      send(PET_SPEAK_CHANNEL, message);
    },
    stopSpeaking(): void {
      send(PET_SPEAK_STOP_CHANNEL);
    },
    hide(): void {
      mover.stop();
      if (!window.isDestroyed()) window.hide();
    },
    show(): void {
      if (!window.isDestroyed()) {
        showAtRest();
      }
    },
    leave(): void {
      lifecycle.leave();
    },
    reload(): void {
      deps.onReload?.();
      if (!window.isDestroyed()) {
        window.webContents.reload();
      }
    },
    dispose(): void {
      lifecycle.dispose();
      if (!window.isDestroyed()) window.destroy();
    }
  };
}
