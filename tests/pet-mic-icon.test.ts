// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWakeListener, type WakeListener } from '../src/renderer/pet/wake-listener';
import type { PhraseListener } from '../src/renderer/shared/phrase-listener';
import type { WakeState } from '../src/voice/wake';

interface Harness {
  apply(state: WakeState): void;
  listener: WakeListener;
  mic: HTMLElement;
  level: HTMLElement;
}

function harness(): Harness {
  const mic = document.createElement('button');
  mic.id = 'mic';
  const level = document.createElement('div');
  level.id = 'level';
  const fill = document.createElement('div');
  fill.id = 'level-fill';
  level.append(fill);
  document.body.append(mic, level);

  let handler: ((state: WakeState) => void) | undefined;
  (window as unknown as { tishka: unknown }).tishka = {
    pet: {
      wakePhrase: vi.fn(),
      wakeError: vi.fn(),
      onWakeState: (cb: (state: WakeState) => void) => {
        handler = cb;
        return () => undefined;
      }
    }
  };
  const phraseListener: PhraseListener = {
    start: async () => true,
    stop: () => undefined,
    pause: () => undefined
  };
  const listener = createWakeListener({ createListener: () => phraseListener });
  return { apply: (state) => handler?.(state), listener, mic, level };
}

afterEach(() => {
  document.body.replaceChildren();
  delete (window as unknown as { tishka?: unknown }).tishka;
  vi.restoreAllMocks();
});

describe('значок микрофона показывает действительное состояние записи', () => {
  it('разговор включён: значок активен, полоска уровня видна', () => {
    const h = harness();
    h.apply({ active: true, conversation: true, soon: false });
    expect(h.mic.classList.contains('on')).toBe(true);
    expect(h.mic.classList.contains('waiting')).toBe(false);
    expect(h.level.hidden).toBe(false);
  });

  it('разовая запись строки: значок активен и полоска видна, после конца записи — обычный', () => {
    const h = harness();
    h.apply({ active: false, conversation: false, soon: false });
    expect(h.mic.classList.contains('on')).toBe(false);

    h.listener.setRecorderListening(true);
    expect(h.mic.classList.contains('on')).toBe(true);
    expect(h.level.hidden).toBe(false);

    h.listener.setRecorderListening(false);
    expect(h.mic.classList.contains('on')).toBe(false);
    expect(h.level.hidden).toBe(true);
  });

  it('ожидание службы: значок в виде ожидания', () => {
    const h = harness();
    h.apply({ active: false, conversation: false, soon: false, waiting: true });
    expect(h.mic.classList.contains('waiting')).toBe(true);
    expect(h.mic.classList.contains('on')).toBe(false);
  });

  it('запись выключена: значок обычный, полоска скрыта', () => {
    const h = harness();
    h.apply({ active: true, conversation: true, soon: false });
    h.apply({ active: false, conversation: false, soon: false });
    expect(h.mic.classList.contains('on')).toBe(false);
    expect(h.level.hidden).toBe(true);
  });
});
