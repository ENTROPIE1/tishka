import { globalShortcut } from 'electron';
import type { EventBus } from '../core/types';

export interface HotkeyRegistrar {
  set(hotkey: string, handler: () => void): void;
  dispose(): void;
}

// Горячая клавиша вызова: при смене настроек старая снимается, новая ставится.
export function createHotkeyRegistrar(bus: EventBus): HotkeyRegistrar {
  let current: string | undefined;

  function release(): void {
    if (current === undefined) {
      return;
    }
    try {
      globalShortcut.unregister(current);
    } catch {
      // Клавиша уже снята — не страшно.
    }
    current = undefined;
  }

  return {
    set(hotkey: string, handler: () => void): void {
      release();
      let registered = false;
      try {
        registered = globalShortcut.register(hotkey, handler);
      } catch {
        registered = false;
      }
      if (registered) {
        current = hotkey;
      } else {
        bus.emit({ type: 'error', message: `Не удалось назначить горячую клавишу ${hotkey}` });
      }
    },
    dispose(): void {
      release();
    }
  };
}
