import type { CalendarWeekday } from './types';

const ORDER: CalendarWeekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function pad(value: number): string {
  return String(value).padStart(2, '0');
}

// ISO со смещением местного времени: календарь читаем глазами, UTC-строки неудобны.
export function toLocalIso(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

export function parseMinutes(value: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (match === null) {
    return undefined;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return undefined;
  }
  return hours * 60 + minutes;
}

export function weekdayOf(date: Date): CalendarWeekday {
  return ORDER[date.getDay()];
}

export function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function atTime(day: Date, minutes: number): Date {
  const result = new Date(day);
  result.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return result;
}
