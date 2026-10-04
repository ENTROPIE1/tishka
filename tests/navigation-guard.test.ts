import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }));

import type { BrowserWindow } from 'electron';
import { guardNavigation } from '../src/main/navigation-guard';

interface FakeContents {
  getURL(): string;
  on(event: string, listener: (event: { preventDefault(): void }, url: string) => void): void;
  setWindowOpenHandler(handler: (details: { url: string }) => { action: string }): void;
}

function fakeWindow(own: string): {
  window: BrowserWindow;
  navigate(url: string): { preventDefault: ReturnType<typeof vi.fn> };
  open(url: string): { action: string };
} {
  const listeners = new Map<string, (event: { preventDefault(): void }, url: string) => void>();
  let openHandler: ((details: { url: string }) => { action: string }) | undefined;
  const contents: FakeContents = {
    getURL: () => own,
    on: (event, listener) => listeners.set(event, listener),
    setWindowOpenHandler: (handler) => {
      openHandler = handler;
    }
  };
  const window = { webContents: contents } as unknown as BrowserWindow;
  return {
    window,
    navigate: (url) => {
      const event = { preventDefault: vi.fn() };
      listeners.get('will-navigate')?.(event, url);
      return event;
    },
    open: (url) => openHandler?.({ url }) ?? { action: 'allow' }
  };
}

describe('guardNavigation', () => {
  const own = 'file:///app/renderer/pet/index.html';

  it('переход на внешний адрес отменяется и открывается в браузере', () => {
    const openExternal = vi.fn(async () => undefined);
    const { window, navigate } = fakeWindow(own);
    guardNavigation(window, openExternal);

    const event = navigate('https://mail.example.org/owa/?path=/mail/action/compose');

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith('https://mail.example.org/owa/?path=/mail/action/compose');
  });

  it('собственная страница окна разрешена', () => {
    const openExternal = vi.fn(async () => undefined);
    const { window, navigate } = fakeWindow(own);
    guardNavigation(window, openExternal);

    const event = navigate(own);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('новое окно запрещается, а ссылка уходит в браузер', () => {
    const openExternal = vi.fn(async () => undefined);
    const { window, open } = fakeWindow(own);
    guardNavigation(window, openExternal);

    const result = open('https://example.org/page');

    expect(result.action).toBe('deny');
    expect(openExternal).toHaveBeenCalledWith('https://example.org/page');
  });

  it('внутренняя схема нового окна просто запрещается', () => {
    const openExternal = vi.fn(async () => undefined);
    const { window, open } = fakeWindow(own);
    guardNavigation(window, openExternal);

    const result = open('file:///c:/secret.txt');

    expect(result.action).toBe('deny');
    expect(openExternal).not.toHaveBeenCalled();
  });
});
