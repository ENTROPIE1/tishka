export function isWebUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

// Точный адрес ссылки: dataset.url сохраняет исходную строку без перекодирования,
// href используется только как запасной вариант.
export function linkUrl(anchor: HTMLAnchorElement): string | undefined {
  const stored = anchor.dataset['url'];
  const value = stored !== undefined && stored !== '' ? stored : anchor.getAttribute('href') ?? '';
  return isWebUrl(value) ? value : undefined;
}

function anchorOf(target: EventTarget | null): HTMLAnchorElement | undefined {
  if (!(target instanceof Element)) {
    return undefined;
  }
  const anchor = target.closest('a');
  return anchor instanceof HTMLAnchorElement ? anchor : undefined;
}

// Щелчок по любой ссылке http/https отменяет переход внутри окна и открывает
// адрес во внешнем браузере. Так окно приложения не теряет свой интерфейс.
export function installLinkGuard(root: Document | HTMLElement = document): () => void {
  const handler = (event: MouseEvent): void => {
    const anchor = anchorOf(event.target);
    if (anchor === undefined) {
      return;
    }
    const url = linkUrl(anchor);
    if (url === undefined) {
      return;
    }
    event.preventDefault();
    void window.tishka.openExternal(url);
  };
  const listener = handler as EventListener;
  root.addEventListener('click', listener);
  return () => root.removeEventListener('click', listener);
}
