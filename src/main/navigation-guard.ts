import { shell, type BrowserWindow } from 'electron';

function isWebUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export type OpenExternal = (url: string) => Promise<unknown>;

// Страховка главного процесса: ни одно окно приложения не уходит на чужую
// страницу. Переход на адрес, отличный от собственной страницы окна, отменяется,
// а ссылки http/https открываются во внешнем браузере.
export function guardNavigation(window: BrowserWindow, openExternal: OpenExternal = shell.openExternal): void {
  window.webContents.on('will-navigate', (event, url) => {
    if (url === window.webContents.getURL()) {
      return;
    }
    event.preventDefault();
    if (isWebUrl(url)) {
      void openExternal(url);
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) {
      void openExternal(url);
    }
    return { action: 'deny' };
  });
}
