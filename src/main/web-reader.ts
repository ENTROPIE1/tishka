import type { WebContents } from 'electron';
import type { WebReadOptions, WebReadResult, WebReader } from '../core/web/types';
import { checkUrl } from '../core/web/urls';
import { extractPage, sendToBlank } from './web-page';
import { closeWebWindow, openWebWindow } from './web-window';

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_MAX_CHARS = 12000;
const QUIET_MS = 800;

export interface WebReaderHandle {
  read: WebReader;
  dispose(): void;
}

let chain: Promise<unknown> = Promise.resolve();

async function navigate(webContents: WebContents, href: string): Promise<void> {
  try {
    await webContents.loadURL(href);
  } catch {
    // Причину сбоя разбираем по коду ниже: диалог об ошибке загрузки не нужен.
  }
}

async function doRead(target: string, options?: WebReadOptions): Promise<WebReadResult> {
  const checked = checkUrl(target);
  if (!checked.ok) {
    return { ok: false, error: checked.error };
  }

  const webContents = openWebWindow().webContents;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxChars = options?.maxChars ?? DEFAULT_MAX_CHARS;

  let done = false;
  let timedOut = false;
  let failed = false;
  let blocked: string | undefined;
  let statusCode = 0;
  let quiet: ReturnType<typeof setTimeout> | undefined;
  let resolveLoad: (() => void) | undefined;
  const loaded = new Promise<void>((resolve) => {
    resolveLoad = resolve;
  });
  const finish = (): void => {
    if (!done) {
      done = true;
      resolveLoad?.();
    }
  };

  const onFinishLoad = (): void => {
    if (quiet !== undefined) {
      clearTimeout(quiet);
    }
    quiet = setTimeout(finish, QUIET_MS);
  };
  const onFailLoad = (
    _event: Electron.Event,
    errorCode: number,
    _description: string,
    _url: string,
    isMainFrame: boolean
  ): void => {
    if (isMainFrame && errorCode !== -3) {
      failed = true;
      finish();
    }
  };
  const onNavigate = (_event: Electron.Event, _url: string, code: number): void => {
    statusCode = code;
  };
  const onRedirect = (details: Electron.Event, redirectUrl: string): void => {
    const check = checkUrl(redirectUrl);
    if (!check.ok) {
      details.preventDefault();
      blocked = check.error;
      finish();
    }
  };

  webContents.on('did-finish-load', onFinishLoad);
  webContents.on('did-fail-load', onFailLoad);
  webContents.on('did-navigate', onNavigate);
  webContents.on('will-redirect', onRedirect);

  const timer = setTimeout(() => {
    timedOut = true;
    finish();
  }, timeoutMs);

  await navigate(webContents, checked.url.href);
  await loaded;

  clearTimeout(timer);
  if (quiet !== undefined) {
    clearTimeout(quiet);
  }
  webContents.removeListener('did-finish-load', onFinishLoad);
  webContents.removeListener('did-fail-load', onFailLoad);
  webContents.removeListener('did-navigate', onNavigate);
  webContents.removeListener('will-redirect', onRedirect);

  if (blocked !== undefined) {
    await sendToBlank(webContents);
    return { ok: false, error: blocked };
  }

  const page = await extractPage(webContents, maxChars);
  await sendToBlank(webContents);

  if (page === undefined || (failed && page.text === '')) {
    return { ok: false, error: 'Страница не открылась' };
  }
  if (statusCode === 401 || statusCode === 403 || (page.hasPassword && page.text === '')) {
    return { ok: false, error: 'Страница требует входа' };
  }
  if (page.text === '') {
    if (timedOut) {
      return { ok: false, error: `Страница не ответила за ${Math.round(timeoutMs / 1000)} секунд` };
    }
    return { ok: false, error: 'На странице нет текста' };
  }
  return {
    ok: true,
    url: checked.url.href,
    title: page.title,
    text: page.text,
    truncated: page.truncated,
    links: page.links
  };
}

function read(url: string, options?: WebReadOptions): Promise<WebReadResult> {
  const task = chain.then(() => doRead(url, options));
  chain = task.catch(() => undefined);
  return task;
}

function dispose(): void {
  closeWebWindow();
}

export function createWebReader(): WebReaderHandle {
  return { read, dispose };
}
