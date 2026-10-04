// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ASK_MAX_LENGTH, askCardElement, type AskCardActions } from '../src/renderer/shared/ask-card';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function makeActions(): AskCardActions & { send: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> } {
  const send = vi.fn<(text: string) => void>();
  const cancel = vi.fn<() => void>();
  return { send, cancel, onSend: send, onCancel: cancel };
}

function mount(actions: AskCardActions): { card: HTMLElement; field: HTMLTextAreaElement } {
  const card = askCardElement({ title: 'Текст для итога недели', placeholder: 'Заметки' }, actions);
  document.body.append(card);
  const field = card.querySelector<HTMLTextAreaElement>('.ask-input');
  if (field === null) {
    throw new Error('Поле ввода не найдено');
  }
  return { card, field };
}

function press(field: HTMLTextAreaElement, init: KeyboardEventInit): void {
  field.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
}

describe('askCardElement', () => {
  it('показывает заголовок и подсказку поля', () => {
    const { card, field } = mount(makeActions());
    expect(card.querySelector('.card-title')?.textContent).toBe('Текст для итога недели');
    expect(field.placeholder).toBe('Заметки');
  });

  it('Ctrl+Enter отправляет текст поля', () => {
    const actions = makeActions();
    const { field } = mount(actions);

    field.value = 'заметки за неделю';
    field.dispatchEvent(new Event('input'));
    press(field, { key: 'Enter', ctrlKey: true });

    expect(actions.send).toHaveBeenCalledWith('заметки за неделю');
  });

  it('пустой текст не отправляется ни кнопкой, ни Ctrl+Enter', () => {
    const actions = makeActions();
    const { card, field } = mount(actions);
    const send = card.querySelector<HTMLButtonElement>('.ask-send');
    if (send === null) {
      throw new Error('Кнопка отправки не найдена');
    }

    send.click();
    press(field, { key: 'Enter', ctrlKey: true });

    expect(actions.send).not.toHaveBeenCalled();
  });

  it('Esc отменяет ввод', () => {
    const actions = makeActions();
    const { field } = mount(actions);

    press(field, { key: 'Escape' });

    expect(actions.cancel).toHaveBeenCalledOnce();
    expect(actions.send).not.toHaveBeenCalled();
  });

  it('текст длиннее предела блокирует кнопку и показывает подсказку', () => {
    const actions = makeActions();
    const { card, field } = mount(actions);
    const send = card.querySelector<HTMLButtonElement>('.ask-send');
    const hint = card.querySelector<HTMLElement>('.ask-hint');
    if (send === null || hint === null) {
      throw new Error('Элементы карточки не найдены');
    }

    expect(send.disabled).toBe(false);
    expect(hint.hidden).toBe(true);

    field.value = 'х'.repeat(ASK_MAX_LENGTH + 1);
    field.dispatchEvent(new Event('input'));

    expect(send.disabled).toBe(true);
    expect(hint.hidden).toBe(false);
    press(field, { key: 'Enter', ctrlKey: true });
    expect(actions.send).not.toHaveBeenCalled();
  });

  it('после отправки карточка заменяется строкой «Текст отправлен»', () => {
    const actions = makeActions();
    const { card, field } = mount(actions);

    field.value = 'готово';
    field.dispatchEvent(new Event('input'));
    press(field, { key: 'Enter', ctrlKey: true });

    expect(card.querySelector('.ask-sent')?.textContent).toBe('Текст отправлен');
    expect(card.querySelector('.ask-input')).toBeNull();
  });

  it('при появлении поле получает фокус', async () => {
    const { field } = mount(makeActions());

    await Promise.resolve();

    expect(document.activeElement).toBe(field);
  });
});
