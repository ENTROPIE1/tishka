// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComposer, PLACEHOLDER_IDLE, PLACEHOLDER_LISTENING } from '../src/renderer/pet/composer';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'src/renderer/pet/index.html'), 'utf8');

function bodyMarkup(): string {
  const match = html.match(/<body>([\s\S]*)<\/body>/);
  return match?.[1] ?? '';
}

interface Mounted {
  composer: ReturnType<typeof createComposer>;
  input: HTMLInputElement;
  send: ReturnType<typeof vi.fn>;
  escape: ReturnType<typeof vi.fn>;
  expand: ReturnType<typeof vi.fn>;
}

function mount(): Mounted {
  document.body.innerHTML = bodyMarkup();
  const send = vi.fn<(text: string) => void>();
  const escape = vi.fn<() => void>();
  const expand = vi.fn<() => void>();
  const composer = createComposer({ onSend: send, onEscape: escape, onExpand: expand });
  const host = document.getElementById('composer-host');
  if (host === null) {
    throw new Error('нет composer-host');
  }
  host.append(composer.element);
  return { composer, input: composer.input, send, escape, expand };
}

function key(input: HTMLInputElement, value: string): void {
  input.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }));
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('разметка окна-питомца', () => {
  it('блоки идут сверху вниз: карточка, облачко, ёжик, строка', () => {
    mount();
    const pet = document.getElementById('pet');
    if (pet === null) {
      throw new Error('нет #pet');
    }
    expect(Array.from(pet.children).map((child) => child.id)).toEqual([
      'card-host',
      'bubble',
      'character',
      'composer-host'
    ]);
  });

  it('поле ввода живёт в строке, а облачко не содержит полей', () => {
    const { input } = mount();
    expect(input.parentElement?.id).toBe('composer');
    expect(document.querySelector('#bubble input, #bubble textarea')).toBeNull();
    expect(document.querySelector('#composer #input')).not.toBeNull();
  });

  it('в разметке строки нет атрибутов style', () => {
    const { composer } = mount();
    expect(composer.element.querySelectorAll('[style]')).toHaveLength(0);
  });
});

describe('поведение строки общения', () => {
  it('Enter отправляет текст и очищает поле', () => {
    const { input, send } = mount();
    input.value = 'утро пятницы';
    key(input, 'Enter');
    expect(send).toHaveBeenCalledWith('утро пятницы');
    expect(input.value).toBe('');
  });

  it('Esc с текстом очищает поле и не прячет Тишку', () => {
    const { input, escape } = mount();
    input.value = 'черновик';
    key(input, 'Escape');
    expect(input.value).toBe('');
    expect(escape).not.toHaveBeenCalled();
  });

  it('Esc с пустым полем прячет Тишку', () => {
    const { input, escape } = mount();
    key(input, 'Escape');
    expect(escape).toHaveBeenCalledOnce();
  });

  it('во время «думает» отправка встаёт в очередь и уходит после ответа', () => {
    const { composer, input, send } = mount();
    composer.setBusy(true);
    input.value = 'вторая фраза';
    key(input, 'Enter');
    expect(send).not.toHaveBeenCalled();
    expect(input.value).toBe('');

    composer.setBusy(false);
    expect(send).toHaveBeenCalledWith('вторая фраза');
  });

  it('свёрнутая строка разворачивается по щелчку', () => {
    const { composer, expand } = mount();
    composer.setCollapsed(true);
    expect(composer.isCollapsed()).toBe(true);
    expect(composer.element.classList.contains('collapsed')).toBe(true);

    composer.element.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(composer.isCollapsed()).toBe(false);
    expect(composer.element.classList.contains('collapsed')).toBe(false);
    expect(expand).toHaveBeenCalledOnce();
  });

  it('подсказка поля зависит от микрофона', () => {
    const { composer, input } = mount();
    expect(input.placeholder).toBe(PLACEHOLDER_IDLE);
    composer.setListening(true);
    expect(input.placeholder).toBe(PLACEHOLDER_LISTENING);
    composer.setListening(false);
    expect(input.placeholder).toBe(PLACEHOLDER_IDLE);
  });
});
