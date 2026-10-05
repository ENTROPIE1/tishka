import { mountAutomationsScreen } from './automations/screen';
import { mountDoneScreen } from './done/screen';
import { mountSettingsScreens } from './settings-screens';
import { createShell, isScreenName, type Shell, type ScreenName } from './shell';

interface NavigateDetail {
  screen?: unknown;
  skillId?: unknown;
}

function screen(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node === null) {
    throw new Error(`Не найден экран: ${id}`);
  }
  return node;
}

// Собирает навигацию окна: экраны чата и настроек, полосу слева, переходы
// из главного процесса и перечитывание данных при показе экрана.
export function initAppShell(): Shell {
  const sections = mountSettingsScreens();
  mountAutomationsScreen(screen('screen-automations'));
  const done = mountDoneScreen(screen('screen-done'));
  const screens: Record<ScreenName, HTMLElement> = {
    chat: screen('screen-chat'),
    connections: screen('screen-connections'),
    memory: screen('screen-memory'),
    voice: screen('screen-voice'),
    persona: screen('screen-persona'),
    automations: screen('screen-automations'),
    done: screen('screen-done')
  };
  const shell = createShell({
    screens,
    nav: screen('nav'),
    subscribe: (listener) => window.tishka.onNavigate(listener),
    onShow: (name) => {
      sections[name]?.refresh();
      if (name === 'done') {
        void done.refresh();
      }
    }
  });

  // Ссылка из карточки «Навык сохранён»: показывает экран и подсвечивает карточку.
  document.addEventListener('tishka:navigate', (event) => {
    const detail = (event as CustomEvent<NavigateDetail>).detail;
    if (detail === undefined) {
      return;
    }
    if (isScreenName(detail.screen)) {
      shell.show(detail.screen);
    }
    if (typeof detail.skillId === 'string') {
      document.dispatchEvent(new CustomEvent('tishka:automations-highlight', { detail: { skillId: detail.skillId } }));
    }
  });

  return shell;
}
