import { screen, type BrowserWindow } from 'electron';
import { PET_FOCUS_INPUT_CHANNEL, PET_POINTER_CHANNEL } from './ipc-channels';

export interface PetActivation {
  focus(): void;
  focusInput(): void;
  sendPointer(): void;
}

// Фокус окна и пересчёт интерактивности по текущему положению курсора.
// Курсор известен только главному процессу, поэтому позицию отдаёт он:
// страница сама решает, попадает ли точка в ёжика, облачко или строку ввода.
export function createPetActivation(window: BrowserWindow): PetActivation {
  function focusInput(): void {
    if (!window.isDestroyed()) window.webContents.send(PET_FOCUS_INPUT_CHANNEL);
  }

  function sendPointer(): void {
    if (window.isDestroyed() || !window.isVisible()) return;
    const cursor = screen.getCursorScreenPoint();
    const bounds = window.getBounds();
    window.webContents.send(PET_POINTER_CHANNEL, { x: cursor.x - bounds.x, y: cursor.y - bounds.y });
  }

  return {
    focusInput,
    sendPointer,
    focus(): void {
      if (window.isDestroyed()) return;
      window.focus();
      focusInput();
    }
  };
}
