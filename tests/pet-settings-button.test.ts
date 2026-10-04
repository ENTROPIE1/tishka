// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComposer } from '../src/renderer/pet/composer';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('кнопка настроек в строке ввода', () => {
  it('есть в разметке с подписью «Настройки» и нажатие вызывает openSettings один раз', () => {
    const onSettings = vi.fn<() => void>();
    const composer = createComposer({
      onSend: vi.fn(),
      onEscape: vi.fn(),
      onExpand: vi.fn(),
      onFocus: vi.fn(),
      onSettings
    });
    document.body.append(composer.element);

    const button = composer.element.querySelector<HTMLButtonElement>('[aria-label="Настройки"]');
    expect(button).not.toBeNull();
    expect(button?.title).toBe('Настройки');

    button?.click();
    expect(onSettings).toHaveBeenCalledOnce();
  });
});
