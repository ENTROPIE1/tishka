import { describe, expect, it } from 'vitest';
import type { CalendarStore } from '../src/core/calendar/store';
import type { CalendarSyncResult } from '../src/core/calendar/sync';
import { registerCalendarTools } from '../src/core/calendar/tools';
import { defaultCalendarConfig, type CalendarEvent } from '../src/core/calendar/types';
import { createEventBus } from '../src/core/events';
import { createToolRegistry } from '../src/core/tools/registry';

function register(sync?: (enable?: boolean) => Promise<CalendarSyncResult>): ReturnType<typeof createToolRegistry> {
  const registry = createToolRegistry(createEventBus());
  registerCalendarTools(registry, {
    store: {} as CalendarStore,
    provider: () => Promise.resolve([] as CalendarEvent[]),
    config: () => defaultCalendarConfig(),
    now: () => new Date('2026-10-07T10:00:00'),
    sync
  });
  return registry;
}

describe('инструмент calendar_sync', () => {
  it('включает и выключает перенос, отдавая параметр enable', async () => {
    const calls: (boolean | undefined)[] = [];
    const registry = register(async (enable) => {
      calls.push(enable);
      return { ok: true, added: 2, updated: 1, removed: 3 };
    });

    const on = await registry.call('calendar_sync', { enable: true });
    expect(on.ok).toBe(true);
    expect(on.reply?.say).toContain('Включила');

    const off = await registry.call('calendar_sync', { enable: false });
    expect(off.ok).toBe(true);
    expect(off.reply?.say).toContain('Больше не переношу');

    const run = await registry.call('calendar_sync', {});
    expect(run.ok).toBe(true);
    expect(run.content).toBe('Добавлено 2, изменено 1, убрано 3');

    expect(calls).toEqual([true, false, undefined]);
  });

  it('без настроенного переноса возвращает понятную ошибку', async () => {
    const registry = register();
    const result = await registry.call('calendar_sync', {});
    expect(result.ok).toBe(false);
    expect(result.error).toContain('подключение Exchange');
  });
});
