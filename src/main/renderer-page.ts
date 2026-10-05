import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';

export const DEV_UNAVAILABLE_MESSAGE =
  'Сервер разработки недоступен. Закройте Тишку и запустите npm run dev заново';

export interface RendererPageOptions {
  rendererUrl?: string;                        // адрес сервера разработки; нет — страницы с диска
  builtDir?: string;                           // каталог собранных страниц
  fileExists?: (path: string) => boolean;
}

// ABORTED приходит при обычных перенаправлениях: сбой загрузки не наш.
const ERR_ABORTED = -3;

function messageHtml(): string {
  return `<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><title>Тишка</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f6f4;color:#333;font:16px/1.5 'Segoe UI',sans-serif">
<main style="max-width:520px;padding:24px;text-align:center">${DEV_UNAVAILABLE_MESSAGE}</main>
</body></html>`;
}

// Страница окна: в разработке — с сервера разработки, в собранном приложении — с диска.
// Если сервер разработки недоступен (приложение перезапустилось само или терминал
// закрыт), окно берёт собранную страницу с диска, а при её отсутствии показывает
// понятное человеку сообщение.
export function loadRendererPage(
  window: BrowserWindow,
  name: string,
  options: RendererPageOptions = {}
): void {
  const builtDir = options.builtDir ?? join(__dirname, '../renderer');
  const builtPath = join(builtDir, name, 'index.html');
  const fileExists = options.fileExists ?? existsSync;
  const rendererUrl = options.rendererUrl;
  if (rendererUrl === undefined) {
    void window.loadFile(builtPath);
    return;
  }

  let usedFallback = false;
  window.webContents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
    if (usedFallback || !isMainFrame || errorCode === ERR_ABORTED) {
      return;
    }
    usedFallback = true;
    if (fileExists(builtPath)) {
      void window.loadFile(builtPath);
    } else {
      void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(messageHtml())}`);
    }
  });
  void window.loadURL(`${rendererUrl}/${name}/index.html`);
}
