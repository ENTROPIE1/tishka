// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComposer, PLACEHOLDER_IDLE, PLACEHOLDER_LISTENING } from '../src/renderer/pet/composer';
import { applyPetLayout } from '../src/renderer/pet/layout-view';
import { stateLabel } from '../src/renderer/pet/state-label';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'src/renderer/pet/index.html'), 'utf8');
const css = readFileSync(resolve(root, 'src/renderer/pet/pet.css'), 'utf8');

function cssBlock(selector: string): string {
  const match = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? '';
}

function bodyMarkup(): string {
  const match = html.match(/<body>([\s\S]*)<\/body>/);
  return match?.[1] ?? '';
}

function element(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (node === null) {
    throw new Error(`нет #${id}`);
  }
  return node;
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
  element('composer-host').append(composer.element);
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
  it('строка ввода — последний блок и содержит микрофон, поле и кнопку отправки', () => {
    mount();
    const pet = element('pet');
    expect(pet.lastElementChild?.id).toBe('composer-host');
    expect(document.querySelector('#composer #mic')).not.toBeNull();
    expect(document.querySelector('#composer #input')).not.toBeNull();
    expect(document.querySelector('#composer #send')).not.toBeNull();
  });

  it('колонка ответов и ёжик — в одном ряду над строкой', () => {
    mount();
    const answers = element('answers');
    const character = element('character');
    const row = answers.parentElement;
    expect(row).not.toBeNull();
    expect(row?.classList.contains('pet-row')).toBe(true);
    expect(row?.contains(character)).toBe(true);
    const pet = element('pet');
    expect(pet.firstElementChild).toBe(row);
    expect(pet.lastElementChild?.id).toBe('composer-host');
  });

  it('облачко стоит ниже карточки внутри колонки ответов', () => {
    mount();
    const kids = Array.from(element('answers').children).map((child) => child.id);
    expect(kids).toEqual(['card-host', 'bubble']);
    expect(element('bubble').parentElement).toBe(element('answers'));
  });

  it('при зеркальной раскладке у контейнера класс mirrored', () => {
    mount();
    applyPetLayout(element('pet'), { mirrored: true });
    expect(element('pet').classList.contains('mirrored')).toBe(true);

    applyPetLayout(element('pet'), { mirrored: false });
    expect(element('pet').classList.contains('mirrored')).toBe(false);
  });

  it('подпись состояния стоит под ёжиком, состояние — в data-state', () => {
    mount();
    const label = document.querySelector('.state-label');
    expect(label).not.toBeNull();
    expect(element('character').nextElementSibling).toBe(label);
    expect(element('character').getAttribute('data-state')).not.toBeNull();
  });

  it('подпись состояния есть в разметке и видима', () => {
    mount();
    const state = element('state-label');
    expect(state.classList.contains('state-label')).toBe(true);
    expect(state.parentElement?.classList.contains('pet-side')).toBe(true);

    const block = cssBlock('\\.state-label');
    expect(block).not.toBe('');
    expect(block).not.toContain('display: none');
    expect(block).not.toContain('visibility: hidden');
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

describe('подпись состояния', () => {
  it('ждёт, слушает, думает и пусто для остальных состояний', () => {
    expect(stateLabel('idle')).toBe('ждёт');
    expect(stateLabel('listening')).toBe('слушает');
    expect(stateLabel('thinking')).toBe('думает');
    expect(stateLabel('working')).toBe('думает');
    expect(stateLabel('talking')).toBe('');
    expect(stateLabel('sleep')).toBe('');
  });
});
