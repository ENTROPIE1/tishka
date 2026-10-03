import { globalShortcut } from 'electron';
import type { EventBus } from '../core/types';

// Регистрирует глобальную горячую клавишу вызова. Если клавиша занята,
// приложение продолжает работу, а пользователь видит понятную ошибку.
export function registerPetHotkey(bus: EventBus, hotkey: string, wake: () => void): void {
  let registered = false;
  try {
    registered = globalShortcut.register(hotkey, wake);
  } catch {
    registered = false;
  }
  if (!registered) {
    bus.emit({ type: 'error', message: `Не удалось назначить горячую клавишу ${hotkey}` });
  }
}
