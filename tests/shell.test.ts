// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createShell, type ScreenName, type Shell } from '../src/renderer/chat/shell';

const shells: Shell[] = [];

afterEach(() => {
  for (const shell of shells) {
    shell.dispose();
  }
  shells.length = 0;
  document.body.replaceChildren();
});

function setup(onShow?: (name: ScreenName) => void): { shell: Shell; screens: Record<ScreenName, HTMLElement>; navigate(name: string): void } {
  document.body.innerHTML = `
    <nav id="nav">
      <button data-screen="chat"></button>
      <button data-screen="automations"></button>
      <button data-screen="calendar"></button>
      <button data-screen="connections"></button>
      <button data-screen="memory"></button>
      <button data-screen="voice"></button>
      <button data-screen="persona"></button>
      <button data-screen="done"></button>
    </nav>
    <section id="screen-chat"></section>
    <section id="screen-automations" hidden></section>
    <section id="screen-calendar" hidden></section>
    <section id="screen-connections" hidden></section>
    <section id="screen-memory" hidden></section>
    <section id="screen-voice" hidden></section>
    <section id="screen-persona" hidden></section>
    <section id="screen-done" hidden></section>`;

  const screens: Record<ScreenName, HTMLElement> = {
    chat: document.getElementById('screen-chat') as HTMLElement,
    automations: document.getElementById('screen-automations') as HTMLElement,
    calendar: document.getElementById('screen-calendar') as HTMLElement,
    connections: document.getElementById('screen-connections') as HTMLElement,
    memory: document.getElementById('screen-memory') as HTMLElement,
    voice: document.getElementById('screen-voice') as HTMLElement,
    persona: document.getElementById('screen-persona') as HTMLElement,
    done: document.getElementById('screen-done') as HTMLElement
  };

  let navigate = (_name: string): void => undefined;
  const shell = createShell({
    screens,
    nav: document.getElementById('nav') as HTMLElement,
    subscribe: (listener) => {
      navigate = (name) => listener(name);
    },
    onShow
  });
  shells.push(shell);
  return { shell, screens, navigate: (name) => navigate(name) };
}

function pressEscape(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
}

describe('createShell: экраны', () => {
  it('переключение экранов сохраняет текст чата и открытый редактор', () => {
    const { shell, screens } = setup();
    const input = document.createElement('input');
    screens.chat.append(input);
    input.value = 'черновик';
    const editor = document.createElement('div');
    editor.className = 'editor';
    screens.connections.append(editor);

    shell.show('connections');
    shell.show('chat');

    expect(input.value).toBe('черновик');
    expect(screens.connections.querySelector('.editor')).not.toBeNull();
    expect(screens.chat.hidden).toBe(false);
    expect(screens.connections.hidden).toBe(true);
  });

  it('Esc закрывает редактор, а без него возвращает в чат', () => {
    const { shell, screens } = setup();
    shell.show('connections');
    const editor = document.createElement('div');
    editor.className = 'editor';
    screens.connections.append(editor);

    pressEscape();
    expect(screens.connections.querySelector('.editor')).toBeNull();
    expect(shell.current()).toBe('connections');

    pressEscape();
    expect(shell.current()).toBe('chat');
    expect(screens.chat.hidden).toBe(false);
  });

  it('сообщение навигации показывает экран, неизвестное имя игнорируется', () => {
    const { shell, screens, navigate } = setup();

    navigate('memory');
    expect(shell.current()).toBe('memory');
    expect(screens.memory.hidden).toBe(false);

    navigate('nope');
    expect(shell.current()).toBe('memory');
  });

  it('нажатие пункта навигации переключает экран', () => {
    const { shell } = setup();
    const button = document.querySelector<HTMLButtonElement>('[data-screen="voice"]');
    button?.click();
    expect(shell.current()).toBe('voice');
  });

  it('показ экрана сообщает наружу, включая начальный показ', () => {
    const shown: ScreenName[] = [];
    const { shell, navigate } = setup((name) => shown.push(name));

    expect(shown).toEqual(['chat']);

    shell.show('memory');
    navigate('voice');

    expect(shown).toEqual(['chat', 'memory', 'voice']);
  });
});
