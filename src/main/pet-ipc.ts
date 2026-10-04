import { ipcMain } from 'electron';
import {
  PET_BUSY_CHANNEL,
  PET_DRAG_CHANNEL,
  PET_DRAG_END_CHANNEL,
  PET_FOCUS_CHANNEL,
  PET_INTERACTIVE_CHANNEL,
  PET_LISTEN_RESULT_CHANNEL,
  PET_LISTEN_TOGGLE_CHANNEL,
  PET_WAKE_CHANNEL
} from './ipc-channels';
import type { PetListen } from './pet-listen';
import type { PetWindow } from './pet-window';

// Принимает сообщения страницы питомца: вызов, наведение мыши, перетаскивание, запись.
export function registerPetIpc(pet: PetWindow, listen: PetListen): void {
  ipcMain.on(PET_WAKE_CHANNEL, (_event, source: unknown) => {
    if (source === 'name' || source === 'hotkey' || source === 'click' || source === 'trigger') {
      pet.wake(source);
    }
  });

  ipcMain.on(PET_INTERACTIVE_CHANNEL, (_event, value: unknown) => {
    if (typeof value === 'boolean') {
      pet.setInteractive(value);
    }
  });

  ipcMain.on(PET_BUSY_CHANNEL, (_event, value: unknown) => {
    if (typeof value === 'boolean') {
      pet.setBusy(value);
    }
  });

  ipcMain.on(PET_DRAG_CHANNEL, (_event, value: unknown) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      pet.dragBy(value);
    }
  });

  ipcMain.on(PET_DRAG_END_CHANNEL, () => {
    pet.dragEnd();
  });

  ipcMain.on(PET_FOCUS_CHANNEL, () => {
    pet.focusWindow();
  });

  ipcMain.on(PET_LISTEN_TOGGLE_CHANNEL, () => {
    listen.toggle('click');
  });

  ipcMain.on(PET_LISTEN_RESULT_CHANNEL, (_event, value: unknown) => {
    listen.handleResult(value);
  });
}
