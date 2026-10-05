import { describe, expect, it } from 'vitest';
import { createEventBus } from '../src/core/events';
import { createCalendarReminders, createFocusGate } from '../src/core/calendar/reminders';
import { toLocalIso } from '../src/core/calendar/time';
import { defaultCalendarConfig, type CalendarEvent } from '../src/core/calendar/types';
import type { TishkaEvent } from '../src/core/types';

function event(partial: Partial<CalendarEvent> & Pick<CalendarEvent, 'start' | 'end' | 'title'>): CalendarEvent {
  return {
    id: partial.id ?? partial.title,
    allDay: false,
    kind: partial.kind ?? 'meeting',
    source: 'local',
    remindMinutes: partial.remindMinutes ?? null,
    updatedAt: '2026-10-07T00:00:00+03:00',
    ...partial
  };
}

function collect(events: TishkaEvent[]): { bus: ReturnType<typeof createEventBus>; events: TishkaEvent[] } {
  const bus = createEventBus();
  bus.on((item) => events.push(item));
  return { bus, events };
}

describe('createCalendarReminders', () => {
  it('шлёт одно напоминание на событие', async () => {
    const events: TishkaEvent[] = [];
    const { bus } = collect(events);
    let now = new Date('2026-10-07T10:00:00');
    const meeting = event({
      title: 'Демо',
      start: toLocalIso(new Date(now.getTime() + 10 * 60_000)),
      end: toLocalIso(new Date(now.getTime() + 40 * 60_000)),
      remindMinutes: 10
    });
    const reminders = createCalendarReminders({ events: () => [meeting], now: () => now, bus, config: () => defaultCalendarConfig() });

    await reminders.tick();
    await reminders.tick();
    now = new Date(now.getTime() + 60_000);
    await reminders.tick();

    const notify = events.filter((item) => item.type === 'notify');
    expect(notify).toHaveLength(1);
    expect(notify[0].type === 'notify' && notify[0].title).toContain('Демо');
  });

  it('после перезапуска пропущенное больше пяти минут не шлётся', async () => {
    const events: TishkaEvent[] = [];
    const { bus } = collect(events);
    const start = new Date('2026-10-07T10:00:00');
    const meeting = event({
      title: 'Демо',
      start: toLocalIso(start),
      end: toLocalIso(new Date(start.getTime() + 30 * 60_000)),
      remindMinutes: 10
    });
    const now = new Date(start.getTime() - 10 * 60_000 + 10 * 60_000);
    const reminders = createCalendarReminders({ events: () => [meeting], now: () => now, bus, config: () => defaultCalendarConfig() });

    await reminders.tick();
    expect(events.filter((item) => item.type === 'notify')).toHaveLength(0);
  });

  it('включает ссылку на подключение, если она есть', async () => {
    const events: TishkaEvent[] = [];
    const { bus } = collect(events);
    const now = new Date('2026-10-07T10:00:00');
    const meeting = event({
      title: 'Демо',
      start: toLocalIso(new Date(now.getTime() + 10 * 60_000)),
      end: toLocalIso(new Date(now.getTime() + 40 * 60_000)),
      remindMinutes: 10,
      link: 'https://meet.example/abc'
    });
    const reminders = createCalendarReminders({ events: () => [meeting], now: () => now, bus, config: () => defaultCalendarConfig() });

    await reminders.tick();
    const notify = events.find((item) => item.type === 'notify');
    expect(notify !== undefined && notify.type === 'notify' && notify.title).toContain('https://meet.example/abc');
  });

  it('вне рабочего времени не шлёт вслух о рабочей встрече', async () => {
    const events: TishkaEvent[] = [];
    const { bus } = collect(events);
    const now = new Date('2026-10-10T12:00:00');
    const meeting = event({
      title: 'Демо',
      start: toLocalIso(now),
      end: toLocalIso(new Date(now.getTime() + 30 * 60_000)),
      remindMinutes: 0
    });
    const config = { ...defaultCalendarConfig(), quietOutsideWork: true };
    const reminders = createCalendarReminders({ events: () => [meeting], now: () => now, bus, config: () => config });

    await reminders.tick();
    expect(events.filter((item) => item.type === 'notify')).toHaveLength(0);
    expect(events.filter((item) => item.type === 'note')).toHaveLength(1);
  });
});

describe('createFocusGate', () => {
  it('копит уведомления во время focus и выпускает после', () => {
    const events: TishkaEvent[] = [];
    const { bus } = collect(events);
    let focus = true;
    const gate = createFocusGate({ bus, isFocusActive: () => focus });

    gate.emit({ type: 'notify', title: 'Навык готов' });
    expect(gate.pendingCount()).toBe(1);
    expect(events).toHaveLength(0);

    focus = false;
    gate.flush();
    expect(gate.pendingCount()).toBe(0);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('note');
  });
});
