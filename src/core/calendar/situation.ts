import { atTime, parseMinutes, startOfDay, toLocalIso, weekdayOf } from './time';
import type { CalendarConfig, CalendarDayHours, CalendarEvent, CalendarKind } from './types';

export interface CalendarSituation {
  workTime: boolean;
  current?: CalendarEvent;
  next?: CalendarEvent;
  minutesToNext: number | null;
  remainingToday: number;
  free: boolean;
  freeUntil: string | null;
  workEnd: string | null;
}

const BUSY: CalendarKind[] = ['meeting', 'focus', 'personal', 'away'];

const KIND_LABEL: Record<CalendarKind, string> = {
  meeting: 'встреча',
  focus: 'занятость',
  personal: 'личное',
  reminder: 'напоминание',
  away: 'отсутствие'
};

function isBusy(event: CalendarEvent): boolean {
  return BUSY.includes(event.kind);
}

function covers(event: CalendarEvent, ms: number): boolean {
  return Date.parse(event.start) <= ms && ms < Date.parse(event.end);
}

function dayHours(config: CalendarConfig, now: Date): CalendarDayHours | null {
  return config.workHours.days[weekdayOf(now)] ?? null;
}

function minutesOf(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function withinLunch(config: CalendarConfig, now: Date): boolean {
  const lunch = config.workHours.lunch;
  if (lunch === undefined) {
    return false;
  }
  const start = parseMinutes(lunch.start);
  const end = parseMinutes(lunch.end);
  if (start === undefined || end === undefined) {
    return false;
  }
  const nowMin = minutesOf(now);
  return nowMin >= start && nowMin < end;
}

function relevant(events: CalendarEvent[]): CalendarEvent[] {
  return events.filter((event) => event.kind !== 'reminder');
}

export function isWorkTime(config: CalendarConfig, now: Date): boolean {
  const hours = dayHours(config, now);
  if (hours === null) {
    return false;
  }
  const startMin = parseMinutes(hours.start);
  const endMin = parseMinutes(hours.end);
  return (
    startMin !== undefined &&
    endMin !== undefined &&
    minutesOf(now) >= startMin &&
    minutesOf(now) < endMin &&
    !withinLunch(config, now)
  );
}

export function situation(events: CalendarEvent[], config: CalendarConfig, now: Date): CalendarSituation {
  const nowMs = now.getTime();
  const day = startOfDay(now);
  const hours = dayHours(config, now);
  const endMin = hours === null ? undefined : parseMinutes(hours.end);
  const workTime = isWorkTime(config, now);

  const workEnd = endMin === undefined ? null : toLocalIso(atTime(day, endMin));
  const list = relevant(events).sort((a, b) => a.start.localeCompare(b.start));

  const currentList = list.filter((event) => covers(event, nowMs));
  const current = currentList.length === 0 ? undefined : currentList[currentList.length - 1];

  const next = list.find((event) => Date.parse(event.start) > nowMs);
  const minutesToNext = next === undefined ? null : Math.round((Date.parse(next.start) - nowMs) / 60_000);

  const remainingToday = list.filter(
    (event) => Date.parse(event.start) >= day.getTime() && Date.parse(event.end) > nowMs
  ).length;

  const busy = list.filter((event) => isBusy(event));
  const free = busy.every((event) => !covers(event, nowMs));

  let freeUntil: string | null = null;
  if (free) {
    const nextBusy = busy.find((event) => Date.parse(event.start) > nowMs);
    const limit = workEnd === null ? undefined : Date.parse(workEnd);
    if (limit !== undefined) {
      const boundary = nextBusy === undefined ? limit : Math.min(Date.parse(nextBusy.start), limit);
      if (boundary > nowMs) {
        freeUntil = toLocalIso(new Date(boundary));
      }
    }
  }

  const result: CalendarSituation = {
    workTime,
    minutesToNext,
    remainingToday,
    free,
    freeUntil,
    workEnd
  };
  if (current !== undefined) {
    result.current = current;
  }
  if (next !== undefined) {
    result.next = next;
  }
  return result;
}

function clock(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function humanMinutes(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours > 0 && minutes > 0) {
    return `${hours} ч ${minutes} мин`;
  }
  return hours > 0 ? `${hours} ч` : `${minutes} мин`;
}

// Одна-две строки обстановки для системной подсказки хода.
export function situationLine(state: CalendarSituation, now: Date): string {
  const parts: string[] = [];
  if (state.workTime) {
    let line = 'Сейчас рабочее время';
    if (state.workEnd !== null) {
      const left = Math.max(0, Math.round((Date.parse(state.workEnd) - now.getTime()) / 60_000));
      line += `, до конца дня ${humanMinutes(left)}`;
    }
    parts.push(`${line}.`);
  } else {
    parts.push('Сейчас нерабочее время.');
  }
  if (state.current !== undefined) {
    parts.push(`Идёт ${KIND_LABEL[state.current.kind]} «${state.current.title}» до ${clock(new Date(state.current.end))}.`);
  }
  if (state.next !== undefined) {
    parts.push(`Следующая — «${state.next.title}» в ${clock(new Date(state.next.start))}.`);
  }
  return parts.join(' ');
}
