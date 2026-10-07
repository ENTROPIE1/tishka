// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { askConfirm } from '../src/renderer/shared/app-confirm';

afterEach(() => {
  document.body.replaceChildren();
});

describe('askConfirm', () => {
  it('показывает текст и кнопки в стиле приложения, не системный диалог', async () => {
    const pending = askConfirm('Забыть все записи памяти?');
    const overlay = document.querySelector('.app-confirm-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay?.querySelector('.app-confirm-text')?.textContent).toBe('Забыть все записи памяти?');
    expect(overlay?.querySelector('.button-danger')?.textContent).toBe('Удалить');
    expect(overlay?.querySelector('.button-secondary')?.textContent).toBe('Отмена');
    overlay?.querySelector<HTMLButtonElement>('.button-secondary')?.click();
    await expect(pending).resolves.toBe(false);
    expect(document.querySelector('.app-confirm-overlay')).toBeNull();
  });

  it('Удалить подтверждает, Escape отменяет', async () => {
    const yes = askConfirm('Удалить событие?');
    document.querySelector<HTMLButtonElement>('.button-danger')?.click();
    await expect(yes).resolves.toBe(true);

    const no = askConfirm('Ещё раз?');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await expect(no).resolves.toBe(false);
  });
});
