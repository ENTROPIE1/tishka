// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keepMicOpen } from '../src/voice/warm';
import { createWakeListener } from '../src/renderer/pet/wake-listener';
import type { PhraseListener } from '../src/renderer/shared/phrase-listener';
import type { WakeState } from '../src/voice/wake';

const MINUTE = 60000;

afterEach(() => {
  document.body.replaceChildren();
  delete (window as unknown as { tishka?: unknown }).tishka;
  vi.useRealTimers();
});

describe('keepMicOpen', () => {
  it('включённый отклик на имя держит микрофон всегда', () => {
    expect(
      keepMicOpen({
        ready: true,
        wakeEnabled: true,
        ownerActive: false,
        lastInteractionAt: 0,
        now: 1000 * MINUTE,
        warmMinutes: 30
      })
    ).toBe(true);
  });

  it('в тёплое время после обращения микрофон открыт, позже — закрыт', () => {
    const base = { ready: true, wakeEnabled: false, ownerActive: false, lastInteractionAt: 0, warmMinutes: 30 };
    expect(keepMicOpen({ ...base, now: 10 * MINUTE })).toBe(true);
    expect(keepMicOpen({ ...base, now: 29 * MINUTE })).toBe(true);
    expect(keepMicOpen({ ...base, now: 31 * MINUTE })).toBe(false);
  });

  it('не готовая служба закрывает микрофон', () => {
    expect(
      keepMicOpen({
        ready: false,
        wakeEnabled: true,
        ownerActive: true,
        lastInteractionAt: 0,
        now: 0,
        warmMinutes: 30
      })
    ).toBe(false);
  });
});

describe('тёплое состояние окна-питомца', () => {
  function mount(): { state: (value: WakeState) => void; starts: number[]; stops: number[] } {
    let handler: ((state: WakeState) => void) | undefined;
    (window as unknown as { tishka: unknown }).tishka = {
      pet: {
        onWakeState: (listener: (state: WakeState) => void) => {
          handler = listener;
          return () => undefined;
        },
        wakePhrase: () => undefined
      }
    };
    const starts: number[] = [];
    const stops: number[] = [];
    const fake: PhraseListener = {
      start: async () => {
        starts.push(1);
        return true;
      },
      pause: () => undefined,
      resume: () => undefined,
      stop: () => {
        stops.push(1);
      }
    };
    createWakeListener({ createListener: () => fake });
    return {
      state: (value) => handler?.(value),
      starts,
      stops
    };
  }

  it('два появления подряд открывают микрофон один раз', () => {
    const mounted = mount();
    const active: WakeState = { active: true, conversation: true, soon: false, sensitivity: 'normal' };
    mounted.state(active);
    mounted.state(active);
    mounted.state(active);

    expect(mounted.starts).toHaveLength(1);
    expect(mounted.stops).toHaveLength(0);
  });

  it('после долгого простоя микрофон закрывается', () => {
    const mounted = mount();
    mounted.state({ active: true, conversation: true, soon: false, sensitivity: 'normal' });
    mounted.state({ active: false, conversation: false, soon: false, sensitivity: 'normal' });

    expect(mounted.stops.length).toBeGreaterThan(0);
  });
});
