import { startOfDay } from '../../../core/calendar/time';
import type { CalendarEvent } from '../../../core/calendar/types';

export const DAY_MINUTES = 1440;
export const MIN_BLOCK_MINUTES = 20;

export interface PositionedEvent {
  event: CalendarEvent;
  startMin: number;
  endMin: number;
  column: number;
  columns: number;
}

export function intersectsDay(event: CalendarEvent, day: Date): boolean {
  const from = startOfDay(day).getTime();
  const to = from + 86_400_000;
  const start = Date.parse(event.start);
  const end = Date.parse(event.end);
  return !Number.isNaN(start) && !Number.isNaN(end) && start < to && end > from;
}

function minutesInto(day: Date, iso: string): number {
  return (Date.parse(iso) - startOfDay(day).getTime()) / 60_000;
}

// Раскладывает события дня по колонкам: пересекающиеся стоят рядом, а не друг
// поверх друга. Число колонок одинаково для всего дня — так сетка ровнее.
export function layoutDay(events: CalendarEvent[], day: Date): PositionedEvent[] {
  const items = events
    .filter((event) => !event.allDay && intersectsDay(event, day))
    .map((event) => {
      const rawStart = Math.max(0, Math.min(DAY_MINUTES, minutesInto(day, event.start)));
      const rawEnd = Math.max(0, Math.min(DAY_MINUTES, minutesInto(day, event.end)));
      return {
        event,
        startMin: rawStart,
        endMin: Math.max(rawStart + MIN_BLOCK_MINUTES, rawEnd)
      };
    })
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const columnEnds: number[] = [];
  const positioned = items.map((item) => {
    let column = columnEnds.findIndex((end) => end <= item.startMin);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(item.endMin);
    } else {
      columnEnds[column] = item.endMin;
    }
    return { ...item, column, columns: 1 };
  });
  const columns = Math.max(1, columnEnds.length);
  for (const item of positioned) {
    item.columns = columns;
  }
  return positioned;
}

export function allDayEvents(events: CalendarEvent[], day: Date): CalendarEvent[] {
  return events
    .filter((event) => event.allDay && intersectsDay(event, day))
    .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}

const WEEKDAY_START = 1;   // понедельник

export function startOfWeek(day: Date): Date {
  const base = startOfDay(day);
  const shift = (base.getDay() - WEEKDAY_START + 7) % 7;
  base.setDate(base.getDate() - shift);
  return base;
}

export function addDays(day: Date, days: number): Date {
  const result = new Date(day);
  result.setDate(result.getDate() + days);
  return result;
}

export function isSameDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}
