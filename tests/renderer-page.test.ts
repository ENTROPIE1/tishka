import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { createMemoryWatch } from '../src/main/memory-watch';
import { DEV_UNAVAILABLE_MESSAGE, loadRendererPage } from '../src/main/renderer-page';
import { startupAction } from '../src/main/startup';

interface FakeWindow {
  window: BrowserWindow;
  loadURL: ReturnType<typeof vi.fn>;
  loadFile: ReturnType<typeof vi.fn>;
  failLoad(errorCode: number, isMainFrame?: boolean): void;
}

type FailListener = (
  event: unknown,
  errorCode: number,
  description: string,
  url: string,
  isMainFrame: boolean
) => void;

function fakeWindow(): FakeWindow {
  const loadURL = vi.fn();
  const loadFile = vi.fn();
  let listener: FailListener | undefined;
  const contents = {
    on: (event: string, callback: FailListener) => {
      if (event === 'did-fail-load') {
        listener = callback;
      }
    }
  };
  const window = { loadURL, loadFile, webContents: contents } as unknown as BrowserWindow;
  return {
    window,
    loadURL,
    loadFile,
    failLoad: (errorCode, isMainFrame = true) => listener?.({}, errorCode, 'сбой', 'url', isMainFrame)
  };
}

const BUILT_DIR = join('C:', 'app', 'out', 'renderer');
const BUILT_PATH = join(BUILT_DIR, 'chat', 'index.html');

describe('loadRendererPage: разработка', () => {
  it('успешная загрузка идёт с сервера разработки, диск не трогается', () => {
    const win = fakeWindow();
    const fileExists = vi.fn(() => true);

    loadRendererPage(win.window, 'chat', {
      rendererUrl: 'http://localhost:5173',
      builtDir: BUILT_DIR,
      fileExists
    });

    expect(win.loadURL).toHaveBeenCalledWith('http://localhost:5173/chat/index.html');
    expect(win.loadFile).not.toHaveBeenCalled();
    expect(fileExists).not.toHaveBeenCalled();
  });

  it('сервер разработки недоступен, собранная страница есть — грузим её с диска', () => {
    const win = fakeWindow();
    loadRendererPage(win.window, 'chat', {
      rendererUrl: 'http://localhost:5173',
      builtDir: BUILT_DIR,
      fileExists: () => true
    });

    win.failLoad(-102);

    expect(win.loadFile).toHaveBeenCalledWith(BUILT_PATH);
  });

  it('сервер разработки недоступен, собранной страницы нет — понятное сообщение', () => {
    const win = fakeWindow();
    loadRendererPage(win.window, 'chat', {
      rendererUrl: 'http://localhost:5173',
      builtDir: BUILT_DIR,
      fileExists: () => false
    });

    win.failLoad(-102);

    const url = String(win.loadURL.mock.calls.at(-1)?.[0]);
    expect(url.startsWith('data:text/html')).toBe(true);
    expect(decodeURIComponent(url)).toContain(DEV_UNAVAILABLE_MESSAGE);
    expect(win.loadFile).not.toHaveBeenCalled();
  });

  it('сбой непрочитанного кадра и отмена не запускают запасной путь', () => {
    const win = fakeWindow();
    const fileExists = vi.fn(() => true);
    loadRendererPage(win.window, 'chat', {
      rendererUrl: 'http://localhost:5173',
      builtDir: BUILT_DIR,
      fileExists
    });

    win.failLoad(-102, false);
    win.failLoad(-3);

    expect(win.loadFile).not.toHaveBeenCalled();
    expect(fileExists).not.toHaveBeenCalled();
  });
});

describe('loadRendererPage: собранное приложение', () => {
  it('без адреса сервера страница сразу грузится с диска', () => {
    const win = fakeWindow();

    loadRendererPage(win.window, 'pet', { builtDir: BUILT_DIR, fileExists: () => true });

    expect(win.loadFile).toHaveBeenCalledWith(join(BUILT_DIR, 'pet', 'index.html'));
    expect(win.loadURL).not.toHaveBeenCalled();
  });
});

describe('перезапуск по пределу памяти в собранном приложении', () => {
  it('окно загружается с диска, а ёж появляется по обычным правилам запуска', () => {
    const relaunch = vi.fn();
    const watch = createMemoryWatch({
      getMetrics: () => ({ appMb: 2000, sttMb: 100 }),
      getLimitMb: () => 1500,
      isIdle: () => true,
      reloadWindows: vi.fn(),
      notify: vi.fn(),
      relaunch,
      log: vi.fn(),
      graceMs: 60000,
      cooldownMs: 3600000
    });

    watch.check(0);
    watch.check(60000);
    expect(relaunch).toHaveBeenCalledTimes(1);

    const win = fakeWindow();
    loadRendererPage(win.window, 'pet', { builtDir: BUILT_DIR, fileExists: () => true });
    expect(win.loadFile).toHaveBeenCalledWith(join(BUILT_DIR, 'pet', 'index.html'));

    expect(startupAction({ hidden: false, stand: false, hasGatewayKey: true })).toBe('pet');
  });
});
