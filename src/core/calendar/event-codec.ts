import { randomUUID } from 'node:crypto';
import type {
  AddEventInput,
  CalendarEvent,
  CalendarKind,
  CalendarSource
} from './types';

const KINDS: CalendarKind[] = ['meeting', 'focus', 'personal', 'reminder', 'away'];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function pickKind(value: unknown): CalendarKind {
  return typeof value === 'string' && (KINDS as string[]).includes(value) ? (value as CalendarKind) : 'meeting';
}

function pickSource(value: unknown): CalendarSource {
  if (typeof value === 'string' && (value === 'local' || value === 'schedule' || value.startsWith('exchange:'))) {
    return value as CalendarSource;
  }
  return 'local';
}

export function pickRemind(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

export function parseEvent(value: unknown): CalendarEvent | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = pickString(value.id);
  const title = pickString(value.title);
  const start = pickString(value.start);
  const end = pickString(value.end);
  if (id === undefined || title === undefined || start === undefined || end === undefined) {
    return undefined;
  }
  const event: CalendarEvent = {
    id,
    title,
    start,
    end,
    allDay: value.allDay === true,
    kind: pickKind(value.kind),
    source: pickSource(value.source),
    remindMinutes: pickRemind(value.remindMinutes),
    updatedAt: pickString(value.updatedAt) ?? start
  };
  if (typeof value.externalId === 'string') {
    event.externalId = value.externalId;
  }
  if (typeof value.location === 'string') {
    event.location = value.location;
  }
  if (typeof value.link === 'string') {
    event.link = value.link;
  }
  if (typeof value.note === 'string') {
    event.note = value.note;
  }
  return event;
}

export function buildEvent(input: AddEventInput, now: Date): CalendarEvent {
  const event: CalendarEvent = {
    id: randomUUID(),
    title: input.title.trim(),
    start: input.start,
    end: input.end,
    allDay: input.allDay === true,
    kind: input.kind ?? 'meeting',
    source: input.source ?? 'local',
    remindMinutes: pickRemind(input.remindMinutes),
    updatedAt: now.toISOString()
  };
  if (input.externalId !== undefined) {
    event.externalId = input.externalId;
  }
  if (input.location !== undefined) {
    event.location = input.location;
  }
  if (input.link !== undefined) {
    event.link = input.link;
  }
  if (input.note !== undefined) {
    event.note = input.note;
  }
  return event;
}

export function overlapsRange(event: CalendarEvent, startMs: number, endMs: number): boolean {
  const eventStart = Date.parse(event.start);
  const eventEnd = Date.parse(event.end);
  if (Number.isNaN(eventStart) || Number.isNaN(eventEnd)) {
    return false;
  }
  return eventStart < endMs && eventEnd > startMs;
}
