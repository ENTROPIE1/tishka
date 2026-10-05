import { describe, expect, it } from 'vitest';
import { situation, situationLine } from '../src/core/calendar/situation';
import { defaultCalendarConfig, type CalendarEvent } from '../src/core/calendar/types';

const config = defaultCalendarConfig();

function event(partial: Partial<CalendarEvent> & Pick<CalendarEvent, 'start' | 'end' | 'title'>): CalendarEvent {
  return {
    id: partial.id ?? partial.title,
    allDay: partial.allDay ?? false,
    kind: partial.kind ?? 'meeting',
    source: 'local',
    remindMinutes: null,
    updatedAt: '2026-10-07T00:00:00+03:00',
    ...partial
  };
}

describe('situation', () => {
  it('до работы — нерабочее время', () => {
    const state = situation([], config, new Date('2026-10-07T08:00:00'));
    expect(state.workTime).toBe(false);
    expect(state.current).toBeUndefined();
    expect(state.next).toBeUndefined();
  });

  it('во время встречи — текущее событие и занятость', () => {
    const meeting = event({ title: 'Планёрка', start: '2026-10-07T11:00:00+03:00', end: '2026-10-07T12:00:00+03:00' });
    const state = situation([meeting], config, new Date('2026-10-07T11:30:00+03:00'));
    expect(state.workTime).toBe(true);
    expect(state.current?.title).toBe('Планёрка');
    expect(state.free).toBe(false);
  });

  it('между встречами — свободен и видно до какого времени', () => {
    const done = event({ title: 'Созвон', start: '2026-10-07T10:00:00+03:00', end: '2026-10-07T10:30:00+03:00' });
    const next = event({ title: 'Демо', start: '2026-10-07T11:00:00+03:00', end: '2026-10-07T12:00:00+03:00' });
    const state = situation([done, next], config, new Date('2026-10-07T10:45:00+03:00'));
    expect(state.free).toBe(true);
    expect(state.next?.title).toBe('Демо');
    expect(new Date(state.freeUntil!).getTime()).toBe(new Date('2026-10-07T11:00:00+03:00').getTime());
  });

  it('после работы — нерабочее время', () => {
    const state = situation([], config, new Date('2026-10-07T19:00:00'));
    expect(state.workTime).toBe(false);
    expect(state.workEnd).not.toBeNull();
  });

  it('выходной — нет рабочего дня', () => {
    const state = situation([], config, new Date('2026-10-10T12:00:00'));
    expect(state.workTime).toBe(false);
    expect(state.workEnd).toBeNull();
  });

  it('событие на весь день — идёт и занимает', () => {
    const allDay = event({
      title: 'Отпуск',
      start: '2026-10-07T00:00:00+03:00',
      end: '2026-10-08T00:00:00+03:00',
      allDay: true,
      kind: 'away'
    });
    const state = situation([allDay], config, new Date('2026-10-07T12:00:00+03:00'));
    expect(state.current?.title).toBe('Отпуск');
    expect(state.free).toBe(false);
  });

  it('строка обстановки называет работу и текущую встречу', () => {
    const meeting = event({ title: 'Планёрка', start: '2026-10-07T11:00:00+03:00', end: '2026-10-07T12:00:00+03:00' });
    const now = new Date('2026-10-07T11:30:00+03:00');
    const line = situationLine(situation([meeting], config, now), now);
    expect(line).toContain('Сейчас рабочее время');
    expect(line).toContain('Идёт встреча «Планёрка»');
  });
});
