// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWakeListener } from '../src/renderer/pet/wake-listener';
import type { PhraseListener, PhraseListenerOptions } from '../src/renderer/shared/phrase-listener';
import type { WakeState } from '../src/voice/wake';

function harness(): {
  apply(state: WakeState): void;
  created: PhraseListenerOptions[];
  stops(): number;
} {
  const mic = document.createElement('button');
  mic.id = 'mic';
  const level = document.createElement('div');
  level.id = 'level';
  level.append(document.createElement('div'));
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
  const created: PhraseListenerOptions[] = [];
  let stopped = 0;
  createWakeListener({
    createListener: (options: PhraseListenerOptions): PhraseListener => {
      created.push(options);
      return {
        start: async () => true,
        stop: () => {
          stopped += 1;
        },
        pause: () => undefined,
        reset: () => undefined
      };
    }
  });
  return { apply: (state) => handler?.(state), created, stops: () => stopped };
}

afterEach(() => {
  document.body.replaceChildren();
  delete (window as unknown as { tishka?: unknown }).tishka;
  vi.restoreAllMocks();
});

describe('порог доходит до записи без перезапуска приложения', () => {
  it('идущий слушатель имени пересоздаётся с новым порогом', () => {
    const h = harness();
    h.apply({ active: true, conversation: false, soon: false });
    expect(h.created).toHaveLength(1);
    expect(h.created[0].threshold).toBeUndefined();

    h.apply({ active: true, conversation: false, soon: false, threshold: 0.02 });
    expect(h.created).toHaveLength(2);
    expect(h.created[1].threshold).toBe(0.02);
    expect(h.stops()).toBe(1);
  });

  it('тот же порог повторно слушатель не пересоздаёт', () => {
    const h = harness();
    h.apply({ active: true, conversation: false, soon: false, threshold: 0.02 });
    h.apply({ active: true, conversation: false, soon: false, threshold: 0.02 });
    expect(h.created).toHaveLength(1);
    expect(h.stops()).toBe(0);
  });

  it('отрезок прослушивания имени: 4 секунды с перекрытием 0,5 секунды', () => {
    const h = harness();
    h.apply({ active: true, conversation: false, soon: false });
    expect(h.created[0].chunkMs).toBe(4000);
    expect(h.created[0].chunkOverlapMs).toBe(500);
  });
});
