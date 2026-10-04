// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createComposer, type ComposerDeps } from '../src/renderer/chat/composer';

type ComposerDepsMock = ComposerDeps & {
  send: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  echo: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
};

function setup(): {
  composer: ReturnType<typeof createComposer>;
  send: HTMLButtonElement;
  screenLook: HTMLButtonElement;
  input: HTMLTextAreaElement;
  deps: ComposerDepsMock;
} {
  const send = document.createElement('button');
  send.type = 'button';
  send.textContent = 'Отправить';
  const screenLook = document.createElement('button');
  const input = document.createElement('textarea');
  document.body.append(send, screenLook, input);
  const deps: ComposerDepsMock = {
    send: vi.fn<(text: string) => void>(),
    stop: vi.fn<() => void>(),
    echo: vi.fn<(text: string) => void>(),
    status: vi.fn<(text: string) => void>()
  };
  const composer = createComposer({ send, screenLook, input }, deps);
  return { composer, send, screenLook, input, deps };
}

describe('createComposer', () => {
  it('сообщение человека появляется в ленте сразу при отправке', () => {
    const { composer, input, deps } = setup();
    input.value = 'привет';

    composer.sendMessage();

    expect(deps.echo).toHaveBeenCalledWith('привет');
    expect(deps.send).toHaveBeenCalledWith('привет');
    expect(input.value).toBe('');
  });

  it('кнопка с глазом сразу даёт отклик: реплика в ленте, статус, вид «занята»', () => {
    const { composer, screenLook, send, input, deps } = setup();
    input.value = 'что тут?';

    composer.lookAtScreen();

    expect(deps.send).toHaveBeenCalledWith('Посмотри на экран. что тут?');
    expect(deps.echo).toHaveBeenCalledWith('Посмотри на экран. что тут?');
    expect(deps.status).toHaveBeenCalledWith('Смотрю на экран…');
    expect(screenLook.disabled).toBe(true);
    expect(screenLook.classList.contains('busy')).toBe(true);
    expect(send.textContent).toBe('Стоп');
    expect(input.value).toBe('');
    expect(composer.isBusy()).toBe(true);
  });

  it('без вопроса кнопка с глазом отправляет дефолтную просьбу', () => {
    const { composer, deps } = setup();

    composer.lookAtScreen();

    expect(deps.send).toHaveBeenCalledWith('Посмотри, что у меня на экране');
  });

  it('при занятости кнопка с глазом ничего не отправляет', () => {
    const { composer, deps } = setup();

    composer.lookAtScreen();
    composer.lookAtScreen();

    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(deps.stop).not.toHaveBeenCalled();
  });

  it('кнопка «Отправить» при занятости останавливает, а не отправляет', () => {
    const { composer, input, deps } = setup();
    input.value = 'вопрос';
    composer.sendMessage();
    input.value = 'второй вопрос';

    composer.onSendClick();

    expect(deps.stop).toHaveBeenCalledTimes(1);
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('второй вопрос');
  });

  it('Escape при занятости вызывает остановку, в простое — нет', () => {
    const { composer, deps } = setup();

    expect(composer.escape()).toBe(false);
    expect(deps.stop).not.toHaveBeenCalled();

    composer.lookAtScreen();
    expect(composer.escape()).toBe(true);
    expect(deps.stop).toHaveBeenCalledTimes(1);
  });

  it('после простоя кнопки возвращаются в исходный вид', () => {
    const { composer, send, screenLook } = setup();

    composer.lookAtScreen();
    composer.end();

    expect(send.textContent).toBe('Отправить');
    expect(send.classList.contains('stop')).toBe(false);
    expect(screenLook.disabled).toBe(false);
    expect(screenLook.classList.contains('busy')).toBe(false);
  });
});
