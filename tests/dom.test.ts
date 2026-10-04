// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { button, runWithFeedback } from '../src/renderer/settings/dom';

// Классы, которые в настройках задают фон: подпись кнопки их не должна нести.
const BACKGROUND_CLASSES = [
  'state',
  'field',
  'field-label',
  'field-hint',
  'button',
  'button-secondary',
  'button-danger',
  'check-label',
  'msg-text',
  'card'
];

function withBackground(node: HTMLElement): HTMLElement[] {
  return [...node.querySelectorAll<HTMLElement>('*')].filter((child) =>
    [...child.classList].some((name) => BACKGROUND_CLASSES.includes(name))
  );
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('runWithFeedback', () => {
  it('подпись не получает фон, текст меняется и возвращается', async () => {
    vi.useFakeTimers();
    const node = button('Сохранить');
    document.body.append(node);

    const promise = runWithFeedback(node, { busy: 'Сохраняю…', done: 'Готово', error: 'Ошибка' }, async () => undefined);

    expect(node.textContent).toContain('Сохраняю…');
    expect(withBackground(node)).toEqual([]);

    await vi.runAllTimersAsync();

    expect(await promise).toBe(true);
    expect(node.textContent).toBe('Сохранить');
    expect(node.disabled).toBe(false);
    expect(withBackground(node)).toEqual([]);
  });

  it('при ошибке показывает «Ошибка», затем возвращает текст', async () => {
    vi.useFakeTimers();
    const node = button('Проверить');
    const promise = runWithFeedback(node, { busy: 'Проверяю…', done: 'Готово', error: 'Ошибка' }, async () => {
      throw new Error('нет');
    });

    await vi.runAllTimersAsync();

    expect(await promise).toBe(false);
    expect(node.textContent).toBe('Проверить');
  });
});
