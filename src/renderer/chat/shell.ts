export type ScreenName = 'chat' | 'automations' | 'calendar' | 'done' | 'connections' | 'memory' | 'voice' | 'persona';

export const SCREEN_NAMES: readonly ScreenName[] = [
  'chat',
  'automations',
  'calendar',
  'done',
  'connections',
  'memory',
  'voice',
  'persona'
];

export function isScreenName(value: unknown): value is ScreenName {
  return typeof value === 'string' && (SCREEN_NAMES as readonly string[]).includes(value);
}

export interface ShellOptions {
  screens: Record<ScreenName, HTMLElement>;
  nav: HTMLElement;
  subscribe?: (listener: (screen: string) => void) => (() => void) | void;
  onShow?: (name: ScreenName) => void;
  doc?: Document;
  initial?: ScreenName;
}

export interface Shell {
  show(name: ScreenName): void;
  current(): ScreenName;
  dispose(): void;
}

// Переключение экранов без перерисовки: неактивные прячутся, поэтому набранный
// текст, прокрутка ленты и открытый редактор сохраняются.
export function createShell(options: ShellOptions): Shell {
  const doc = options.doc ?? document;
  let current: ScreenName = options.initial ?? 'chat';

  function markButtons(): void {
    for (const button of options.nav.querySelectorAll<HTMLElement>('[data-screen]')) {
      button.classList.toggle('active', button.dataset['screen'] === current);
    }
  }

  function show(name: ScreenName): void {
    current = name;
    for (const key of SCREEN_NAMES) {
      options.screens[key].hidden = key !== name;
    }
    markButtons();
    options.onShow?.(name);
  }

  function onNavClick(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const button = target.closest<HTMLElement>('[data-screen]');
    const name = button?.dataset['screen'];
    if (isScreenName(name)) {
      show(name);
    }
  }

  // Esc закрывает редактор на текущем экране, а если его нет — возвращает в чат.
  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || current === 'chat') {
      return;
    }
    const editor = options.screens[current].querySelector('.editor');
    if (editor !== null) {
      editor.remove();
      return;
    }
    show('chat');
  }

  options.nav.addEventListener('click', onNavClick);
  doc.addEventListener('keydown', onKeydown);
  const unsubscribe = options.subscribe?.((screen) => {
    if (isScreenName(screen)) {
      show(screen);
    }
  });

  show(current);

  return {
    show,
    current: () => current,
    dispose(): void {
      options.nav.removeEventListener('click', onNavClick);
      doc.removeEventListener('keydown', onKeydown);
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    }
  };
}
