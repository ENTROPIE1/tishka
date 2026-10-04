// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMicButton } from '../src/renderer/shared/mic-button';
import { createTalkMode, type TalkModeElements } from '../src/renderer/chat/talk-mode';
import type { PhraseListener } from '../src/renderer/shared/phrase-listener';
import type { ChatTalkState } from '../src/voice/wake';

function setTishka(value: Record<string, unknown>): void {
  (window as unknown as { tishka: unknown }).tishka = value;
}

function mic() {
  return createMicButton({ onText: () => undefined, onLevel: () => undefined, onListeningChange: () => undefined });
}

function elements(): TalkModeElements {
  return {
    level: document.createElement('div'),
    levelFill: document.createElement('div'),
    label: document.createElement('div')
  };
}

function talkState(conversation: boolean): ChatTalkState {
  return { active: true, conversation, soon: false, sensitivity: 'normal' };
}

function setReadyVoice(): void {
  setTishka({
    voice: { status: async () => ({ state: 'ready' }) },
    chatTalk: {
      phrase: vi.fn(),
      toggle: vi.fn(),
      escape: vi.fn(),
      keyboard: vi.fn(),
      onState: () => () => undefined
    }
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('mic-button: готовность распознавания', () => {
  it('кнопка оживает на 42-й попытке опроса', async () => {
    let calls = 0;
    setTishka({
      voice: {
        status: async () => {
          calls += 1;
          return { state: calls <= 41 ? 'starting' : 'ready' };
        }
      }
    });
    const button = mic();
    document.body.append(button.element);

    await vi.advanceTimersByTimeAsync(180_000);

    expect(button.element.disabled).toBe(false);
    button.dispose();
  });

  it('сбой запроса состояния не останавливает опрос', async () => {
    let calls = 0;
    setTishka({
      voice: {
        status: async () => {
          calls += 1;
          if (calls === 1) {
            throw new Error('ipc');
          }
          return { state: 'ready' };
        }
      }
    });
    const button = mic();
    document.body.append(button.element);

    await vi.advanceTimersByTimeAsync(3_000);

    expect(button.element.disabled).toBe(false);
    button.dispose();
  });
});

describe('talk-mode: повтор открытия микрофона', () => {
  it('повторяет попытку через 30 секунд и отменяет её при выключении', async () => {
    setReadyVoice();
    const starts: number[] = [];
    const fake: PhraseListener = {
      start: async () => {
        starts.push(1);
        return false;
      },
      pause: () => undefined,
      stop: () => undefined
    };
    let apply: (state: ChatTalkState) => void = () => undefined;
    const api = (window as unknown as { tishka: { chatTalk: { onState: (cb: (s: ChatTalkState) => void) => () => void } } }).tishka;
    api.chatTalk.onState = (cb) => {
      apply = cb;
      return () => undefined;
    };
    const mode = createTalkMode(elements(), () => undefined, { createListener: () => fake });

    apply(talkState(true));
    await Promise.resolve();
    expect(starts).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(starts.length).toBeGreaterThanOrEqual(2);

    apply(talkState(false));
    const count = starts.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(starts).toHaveLength(count);
    mode.dispose();
  });

  it('dispose снимает слушатель Escape и таймеры', async () => {
    setReadyVoice();
    const fake: PhraseListener = {
      start: async () => false,
      pause: () => undefined,
      stop: () => undefined
    };
    let apply: (state: ChatTalkState) => void = () => undefined;
    const api = (window as unknown as { tishka: { chatTalk: { onState: (cb: (s: ChatTalkState) => void) => () => void } } }).tishka;
    api.chatTalk.onState = (cb) => {
      apply = cb;
      return () => undefined;
    };
    const remove = vi.spyOn(document, 'removeEventListener');
    const mode = createTalkMode(elements(), () => undefined, { createListener: () => fake });
    apply(talkState(true));
    await Promise.resolve();

    expect(vi.getTimerCount()).toBeGreaterThan(0);
    mode.dispose();

    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function));
  });
});

describe('mic-button: dispose', () => {
  it('снимает слушатель Escape и таймеры опроса', async () => {
    setTishka({ voice: { status: async () => ({ state: 'starting' }) } });
    const remove = vi.spyOn(document, 'removeEventListener');
    const button = mic();
    document.body.append(button.element);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    button.dispose();

    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function));
  });
});
