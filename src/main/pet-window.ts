import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import { PET_LISTEN_COMMAND_CHANNEL, PET_SPEAK_CHANNEL, PET_SPEAK_STOP_CHANNEL, PET_WAKE_STATE_CHANNEL } from './ipc-channels';
import { guardNavigation } from './navigation-guard';
import { createPetActivation } from './pet-activation';
import { createPetLifecycle, type PetLifecycle } from './pet-lifecycle';
import { Mover } from './pet-motion';
import { PetPlacement } from './pet-placement';
import type { PetWindow, PetWindowDeps } from './pet-window-types';

export type { PetWindow, PetWindowDeps } from './pet-window-types';

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
  const activation = createPetActivation(window);
  const lifecycle: PetLifecycle = createPetLifecycle({
    window, mover, placement, activation, bus: deps.bus, getConfig: deps.getConfig
  });

  function send(channel: string, payload?: unknown): void {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }

  function showAtRest(): void {
    placement.ensureOnScreen();
    window.setBounds(placement.bounds());
    window.showInactive();
    // Курсор мог уже стоять над строкой ввода: интерактивность считаем сразу.
    activation.sendPointer();
  }

  return {
    wake(source): void {
      // Фокус окна забирают только вызов по клавише и щелчок;
      // при вызове по имени и уведомлении окно остаётся без фокуса.
      deps.bus.emit({ type: 'wake', source });
      if ((source === 'hotkey' || source === 'click') && !window.isDestroyed()) {
        activation.focus();
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
      activation.focus();
    },
    dragBy(deltaX): void {
      if (window.isDestroyed()) return;
      // Двигаем ёжика по экрану; окно и сторона раскладки следуют за ним.
      placement.dragBy(deltaX);
      window.setBounds(placement.bounds());
      lifecycle.sendLayout();
      activation.sendPointer();
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
