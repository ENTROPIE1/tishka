// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComposer } from '../src/renderer/pet/composer';

interface Mounted {
  composer: ReturnType<typeof createComposer>;
  input: HTMLInputElement;
  expand: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
}

function mount(): Mounted {
  const send = vi.fn<(text: string) => void>();
  const escape = vi.fn<() => void>();
  const expand = vi.fn<() => void>();
  const focus = vi.fn<() => void>();
  const composer = createComposer({ onSend: send, onEscape: escape, onExpand: expand, onFocus: focus });
  document.body.append(composer.element);
  return { composer, input: composer.input, expand, focus };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('фокус строки ввода', () => {
  it('щелчок по свёрнутой строке разворачивает её и просит фокус окна', () => {
    const { composer, expand, focus } = mount();
    composer.setCollapsed(true);

    composer.element.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    composer.element.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(composer.isCollapsed()).toBe(false);
    expect(expand).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
  });

  it('щелчок по полю без фокуса окна просит фокус окна', () => {
    const { input, focus } = mount();

    input.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(focus).toHaveBeenCalledOnce();
  });

  it('в состоянии «занят» поле не блокируется', () => {
    const { composer, input } = mount();

    composer.setBusy(true);
    expect(input.disabled).toBe(false);

    composer.setBusy(false);
    expect(input.disabled).toBe(false);
  });
});
