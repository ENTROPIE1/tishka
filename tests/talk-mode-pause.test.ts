// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTalkMode, type TalkModeElements, type TalkMode } from '../src/renderer/chat/talk-mode';
import type { PhraseListener } from '../src/renderer/shared/phrase-listener';
import type { ChatTalkState } from '../src/voice/wake';

function elements(): TalkModeElements {
  return {
    level: document.createElement('div'),
    levelFill: document.createElement('div'),
    label: document.createElement('div')
  };
}

function state(active: boolean, conversation: boolean): ChatTalkState {
  return { active, conversation, soon: false, sensitivity: 'normal' };
}

let mode: TalkMode | undefined;

interface Harness {
  apply: (value: ChatTalkState) => void;
  starts: number;
  stops: number;
  pauses: number;
  resumes: number;
}

function harness(): Harness {
  const result: Harness = { apply: () => undefined, starts: 0, stops: 0, pauses: 0, resumes: 0 };
  const listener: PhraseListener = {
    start: async () => {
      result.starts += 1;
      return true;
    },
    pause: () => {
      result.pauses += 1;
    },
    resume: () => {
      result.resumes += 1;
    },
    stop: () => {
      result.stops += 1;
    }
  };
  (window as unknown as { tishka: unknown }).tishka = {
    voice: { status: async () => ({ state: 'ready' }) },
    chatTalk: {
      phrase: vi.fn(),
      toggle: vi.fn(),
      escape: vi.fn(),
      keyboard: vi.fn(),
      onState: (cb: (value: ChatTalkState) => void) => {
        result.apply = cb;
        return () => undefined;
      }
    }
  };
  mode = createTalkMode(elements(), () => undefined, { createListener: () => listener });
  return result;
}

afterEach(() => {
  mode?.dispose();
  mode = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('talk-mode: пауза калибровки', () => {
  it('на паузе останавливает слушатель, после — запускает снова, значок остаётся включённым', async () => {
    const h = harness();
    h.apply(state(true, true));
    await Promise.resolve();
    expect(h.starts).toBe(1);
    expect(h.stops).toBe(0);
    expect(mode?.button.classList.contains('active')).toBe(true);

    h.apply(state(false, true));
    expect(h.stops).toBe(1);
    expect(mode?.button.classList.contains('active')).toBe(true);

    h.apply(state(true, true));
    await Promise.resolve();
    expect(h.starts).toBe(2);
    expect(mode?.button.classList.contains('active')).toBe(true);
  });

  it('без разговора слушатель не запускается', async () => {
    const h = harness();
    h.apply(state(true, false));
    await Promise.resolve();
    expect(h.starts).toBe(0);
    expect(mode?.button.classList.contains('active')).toBe(false);
  });

  it('набор текста ставит запись на паузу и снимает её через 2 секунды', async () => {
    vi.useFakeTimers();
    const h = harness();
    h.apply(state(true, true));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.starts).toBe(1);

    mode?.keyboard();
    expect(h.pauses).toBe(1);
    expect(h.resumes).toBe(0);
    expect(mode?.button.classList.contains('active')).toBe(true);

    await vi.advanceTimersByTimeAsync(1500);
    mode?.keyboard();
    expect(h.pauses).toBe(2);
    expect(h.resumes).toBe(0);

    await vi.advanceTimersByTimeAsync(2000);
    expect(h.resumes).toBe(1);
    vi.useRealTimers();
  });
});
