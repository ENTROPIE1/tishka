// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWakeListener, type WakeListener } from '../src/renderer/pet/wake-listener';
import { DRAG_RESUME_MS } from '../src/renderer/shared/listen-pause';
import type { PhraseListener } from '../src/renderer/shared/phrase-listener';
import type { WakeState } from '../src/voice/wake';

interface Harness {
  apply: (state: WakeState) => void;
  pauses: boolean[];
}

let listener: WakeListener | undefined;

function harness(): Harness {
  const result: Harness = { apply: () => undefined, pauses: [] };
  const phraseListener: PhraseListener = {
    start: async () => true,
    stop: () => undefined,
    pause: (value) => {
      result.pauses.push(value);
    }
  };
  (window as unknown as { tishka: unknown }).tishka = {
    pet: {
      wakePhrase: vi.fn(),
      wakeError: vi.fn(),
      onWakeState: (cb: (state: WakeState) => void) => {
        result.apply = cb;
        return () => undefined;
      }
    }
  };
  listener = createWakeListener({ createListener: () => phraseListener });
  return result;
}

afterEach(() => {
  listener?.dispose();
  listener = undefined;
  vi.useRealTimers();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('пауза записи при перетаскивании ежа', () => {
  it('нажатие ставит запись на паузу, отпускание снимает её через секунду', () => {
    vi.useFakeTimers();
    const h = harness();
    h.apply({ active: true, conversation: true, soon: false });
    h.pauses.length = 0;

    listener?.beginDrag();
    expect(h.pauses).toEqual([true]);

    listener?.endDrag();
    expect(h.pauses).toEqual([true]);

    vi.advanceTimersByTime(DRAG_RESUME_MS - 1);
    expect(h.pauses).toEqual([true]);

    vi.advanceTimersByTime(1);
    expect(h.pauses).toEqual([true, false]);
  });

  it('повторное нажатие отменяет запланированное возобновление', () => {
    vi.useFakeTimers();
    const h = harness();
    h.apply({ active: true, conversation: true, soon: false });
    h.pauses.length = 0;

    listener?.beginDrag();
    listener?.endDrag();
    listener?.beginDrag();
    vi.advanceTimersByTime(DRAG_RESUME_MS * 2);

    // Пауза не снималась: запланированное возобновление отменено вторым нажатием.
    expect(h.pauses).toEqual([true]);
  });
});
