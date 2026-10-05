import { atTime } from '../../../core/calendar/time';
import type { CalendarConfig, CalendarRange } from '../../../core/calendar/types';
import type { CalendarApi } from './deps';
import { addDays } from './layout';

export const DEFAULT_CONFIG: CalendarConfig = { workHours: { days: {} }, defaultRemindMinutes: 10, quietOutsideWork: false };

export function dayRange(day: Date): CalendarRange {
  const from = new Date(day);
  from.setHours(0, 0, 0, 0);
  const to = addDays(from, 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function defaultApi(): CalendarApi {
  return window.tishka.calendar;
}

export function addQuickFocus(api: CalendarApi, day: Date, startMin: number, durationMin: number, onDone: () => void): void {
  void api
    .add({
      title: 'Занят',
      start: atTime(day, startMin).toISOString(),
      end: atTime(day, startMin + durationMin).toISOString(),
      kind: 'focus',
      remindMinutes: null
    })
    .then(onDone);
}
