import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEventBus } from '../src/core/events';
import { scheduleEvents } from '../src/core/calendar/schedule';
import { createCalendarStore, type CalendarStore } from '../src/core/calendar/store';
import { registerCalendarTools } from '../src/core/calendar/tools';
import { toLocalIso } from '../src/core/calendar/time';
import { defaultCalendarConfig, type CalendarEvent } from '../src/core/calendar/types';
import { createToolRegistry } from '../src/core/tools/registry';
import type { TriggerState } from '../src/core/triggers/state';

let dir: string;
let now: Date;
let store: CalendarStore;
let registry: ReturnType<typeof createToolRegistry>;
let changedCount = 0;
let state: TriggerState;

function provider(): Promise<CalendarEvent[]> {
  return Promise.resolve([...store.all(), ...scheduleEvents(state, [])]);
}

function call(name: string, args: Record<string, unknown> = {}): ReturnType<typeof registry.call> {
  return registry.call(name, args);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tishka-cal-tools-'));
  now = new Date('2026-10-07T10:00:00');
  store = createCalendarStore({ filePath: join(dir, 'calendar.json'), now: () => now });
  await store.load();
  changedCount = 0;
  state = { reminders: [], firedOnce: [], watches: {} };
  registry = createToolRegistry(createEventBus());
  registerCalendarTools(registry, {
    store,
    provider,
    config: () => defaultCalendarConfig(),
    now: () => now,
    emitChanged: () => {
      changedCount += 1;
    }
  });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('registerCalendarTools', () => {
  it('calendar_add разбирает «завтра в 15» и показывает в agenda', async () => {
    const added = await call('calendar_add', { title: 'Демо', when: 'завтра в 15' });
    expect(added.ok).toBe(true);
    expect(changedCount).toBe(1);
    expect(store.all()).toHaveLength(1);

    const today = await call('calendar_agenda', { period: 'today' });
    expect(today.data).toEqual([]);

    const tomorrow = await call('calendar_agenda', { period: 'tomorrow' });
    expect(Array.isArray(tomorrow.data)).toBe(true);
    expect((tomorrow.data as CalendarEvent[])[0].title).toBe('Демо');
  });

  it('calendar_add сообщает о пересечении, но создаёт событие', async () => {
    await call('calendar_add', { title: 'Планёрка', start: '2026-10-07T11:00:00', end: '2026-10-07T12:00:00' });
    const second = await call('calendar_add', { title: 'Другой звонок', start: '2026-10-07T11:30:00', durationMinutes: 30 });
    expect(second.ok).toBe(true);
    expect(second.content).toContain('Пересекается');
    expect(store.all()).toHaveLength(2);
  });

  it('calendar_free возвращает свободные окна в рабочее время', async () => {
    await call('calendar_add', { title: 'Планёрка', start: '2026-10-07T11:00:00', end: '2026-10-07T12:00:00' });
    const free = await call('calendar_free', { durationMinutes: 30 });
    expect(free.ok).toBe(true);
    expect(free.data).toHaveLength(2);
  });

  it('calendar_status отдаёт обстановку', async () => {
    const status = await call('calendar_status');
    expect(status.ok).toBe(true);
    expect(status.content).toContain('рабочее время');
  });

  it('загруженное событие не удаляется и не меняет название', async () => {
    const loaded = await store.add({
      title: 'Из почты',
      start: '2026-10-07T14:00:00',
      end: '2026-10-07T15:00:00',
      source: 'exchange:работа'
    });
    const removed = await call('calendar_remove', { id: loaded.id });
    expect(removed.ok).toBe(false);
    const updated = await call('calendar_update', { id: loaded.id, title: 'Другое', remindMinutes: 5 });
    expect(updated.ok).toBe(true);
    expect(store.find(loaded.id)?.title).toBe('Из почты');
    expect(store.find(loaded.id)?.remindMinutes).toBe(5);
  });

  it('события расписания видны, но не правятся', async () => {
    const at = toLocalIso(new Date('2026-10-08T10:00:00'));
    state.reminders.push({ id: 'r1', at, text: 'Позвонить', done: false });

    const agenda = await call('calendar_agenda', { period: 'tomorrow' });
    expect((agenda.data as CalendarEvent[])[0].title).toBe('Позвонить');

    const update = await call('calendar_update', { id: 'schedule:reminder:r1', note: 'нет' });
    expect(update.ok).toBe(false);
    const remove = await call('calendar_remove', { id: 'schedule:reminder:r1' });
    expect(remove.ok).toBe(false);
  });

  it('calendar_remove удаляет своё событие', async () => {
    const added = await call('calendar_add', { title: 'Встреча', start: '2026-10-07T16:00:00', end: '2026-10-07T17:00:00' });
    const id = (added.data as CalendarEvent).id;
    const removed = await call('calendar_remove', { id });
    expect(removed.ok).toBe(true);
    expect(store.all()).toHaveLength(0);
  });
});
