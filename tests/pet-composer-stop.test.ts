// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComposer } from '../src/renderer/pet/composer';

interface Mounted {
  composer: ReturnType<typeof createComposer>;
  send: HTMLButtonElement;
  input: HTMLInputElement;
  sendText: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

function mount(): Mounted {
  const sendText = vi.fn<(text: string) => void>();
  const stop = vi.fn<() => void>();
  const composer = createComposer({ onSend: sendText, onEscape: vi.fn(), onExpand: vi.fn(), onFocus: vi.fn(), onStop: stop });
  document.body.append(composer.element);
  const send = document.getElementById('send') as HTMLButtonElement;
  const input = document.getElementById('input') as HTMLInputElement;
  return { composer, send, input, sendText, stop };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('кнопка остановки в строке ежа', () => {
  it('пока Тишка занят, кнопка отправки показывает остановку', () => {
    const { composer, send } = mount();

    expect(send.classList.contains('stop')).toBe(false);
    composer.setBusy(true);
    expect(send.classList.contains('stop')).toBe(true);
    expect(send.getAttribute('aria-label')).toBe('Остановить');

    composer.setBusy(false);
    expect(send.classList.contains('stop')).toBe(false);
    expect(send.getAttribute('aria-label')).toBe('Отправить');
  });

  it('нажатие кнопки при занятом Тишке останавливает работу, текст не уходит', () => {
    const { composer, send, input, sendText, stop } = mount();
    composer.setBusy(true);
    input.value = 'домашняя работа';

    send.click();

    expect(stop).toHaveBeenCalledOnce();
    expect(sendText).not.toHaveBeenCalled();
    // Набранный текст не теряется.
    expect(input.value).toBe('домашняя работа');
  });

  it('нажатие кнопки в простое отправляет текст', () => {
    const { send, input, sendText, stop } = mount();
    input.value = 'привет';

    send.click();

    expect(stop).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith('привет');
  });

  it('Escape при занятом Тишке останавливает работу, даже если поле набрано', () => {
    const { composer, input, stop, sendText } = mount();
    composer.setBusy(true);
    input.value = 'не отправляй';

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(stop).toHaveBeenCalledOnce();
    expect(sendText).not.toHaveBeenCalled();
  });

  it('Escape в простое стирает набранный текст и не останавливает', () => {
    const { input, stop } = mount();
    input.value = 'черновик';

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(stop).not.toHaveBeenCalled();
    expect(input.value).toBe('');
  });

  it('набранный по Enter текст при занятом Тишке уходит после ответа', () => {
    const { composer, input, sendText, stop } = mount();
    composer.setBusy(true);
    input.value = 'вопрос в очередь';

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(stop).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();

    composer.setBusy(false);
    expect(sendText).toHaveBeenCalledWith('вопрос в очередь');
  });
});
