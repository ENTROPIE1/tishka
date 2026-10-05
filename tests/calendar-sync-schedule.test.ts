import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCalendarSync, syncIntervalMs } from '../src/core/calendar/sync';
import { defaultCalendarConfig } from '../src/core/calendar/types';
import { createEventBus } from '../src/core/events';
import { createToolRegistry } from '../src/core/tools/registry';
import { EXCHANGE_SERVER, meeting, memoryStore } from './calendar-sync-helpers';

afterEach(() => {
  vi.useRealTimers();
});

describe('createCalendarSync: расписание', () => {
  it('рабочее время — 10 минут, нерабочее — 30', () => {
    expect(syncIntervalMs(true)).toBe(10 * 60_000);
    expect(syncIntervalMs(false)).toBe(30 * 60_000);
  });

  it('start загружает по расписанию рабочего времени', async () => {
    vi.useFakeTimers();
    let now = new Date('2026-10-07T10:00:00');
    const store = memoryStore(() => now);
    const registry = createToolRegistry(createEventBus());
    let calls = 0;
    registry.register(
      { name: 'work__list_meetings', description: '', inputSchema: {}, source: 'mcp:work', readOnly: true },
      async () => {
        calls += 1;
        return { ok: true, content: '', data: { meetings: [meeting()] } };
      }
    );
    const sync = createCalendarSync({
      store,
      registry,
      now: () => now,
      config: () => ({ ...defaultCalendarConfig(), sources: { work: true } }),
      servers: () => [EXCHANGE_SERVER]
    });
    try {
      sync.start();
      now = new Date('2026-10-07T10:01:00');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(calls).toBe(1);

      now = new Date('2026-10-07T10:09:30');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(calls).toBe(1);

      now = new Date('2026-10-07T10:11:00');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(calls).toBe(2);
    } finally {
      sync.stop();
    }
  });
});
