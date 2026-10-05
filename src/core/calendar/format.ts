import { addDays, startOfDay, toLocalIso } from './time';
import type { CalendarEvent, CalendarRange } from './types';

function clock(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function dayRange(day: Date): CalendarRange {
  return { from: toLocalIso(startOfDay(day)), to: toLocalIso(addDays(startOfDay(day), 1)) };
}

// Период для agenda: сегодня, завтра, неделя или явные даты ГГГГ-ММ-ДД.
export function resolveRange(period: string | undefined, now: Date): CalendarRange | undefined {
  const day = startOfDay(now);
  const value = (period ?? 'today').trim().toLowerCase();
  if (value === '' || value === 'today' || value === 'сегодня' || value === 'день') {
    return dayRange(day);
  }
  if (value === 'tomorrow' || value === 'завтра') {
    return dayRange(addDays(day, 1));
  }
  if (value === 'week' || value === 'неделя') {
    return { from: toLocalIso(day), to: toLocalIso(addDays(day, 7)) };
  }
  const range = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(value);
  if (range !== null) {
    return { from: `${range[1]}T00:00:00`, to: `${range[2]}T23:59:59` };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return dayRange(new Date(`${value}T00:00:00`));
  }
  return undefined;
}

export function eventTimeLabel(event: CalendarEvent): string {
  if (event.allDay) {
    return 'весь день';
  }
  return `${clock(event.start)}–${clock(event.end)}`;
}

export function eventSubtitle(event: CalendarEvent): string {
  const parts = [eventTimeLabel(event)];
  if (event.location !== undefined && event.location !== '') {
    parts.push(event.location);
  }
  if (event.source.startsWith('exchange:')) {
    parts.push(`из ${event.source.slice('exchange:'.length)}`);
  }
  if (event.remindMinutes !== null) {
    parts.push(`напоминание за ${event.remindMinutes} мин`);
  }
  return parts.join(' · ');
}
