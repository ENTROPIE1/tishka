import { mountSettingsScreens } from './settings-screens';
import { createShell, type Shell, type ScreenName } from './shell';

function screen(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node === null) {
    throw new Error(`Не найден экран: ${id}`);
  }
  return node;
}

// Собирает навигацию окна: экраны чата и настроек, полосу слева и переходы
// из главного процесса.
export function initAppShell(): Shell {
  mountSettingsScreens();
  const screens: Record<ScreenName, HTMLElement> = {
    chat: screen('screen-chat'),
    connections: screen('screen-connections'),
    memory: screen('screen-memory'),
    voice: screen('screen-voice'),
    persona: screen('screen-persona')
  };
  return createShell({
    screens,
    nav: screen('nav'),
    subscribe: (listener) => window.tishka.onNavigate(listener)
  });
}
