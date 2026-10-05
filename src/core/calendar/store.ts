import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { TimingMark } from '../../main/timing-log';
import {
  type AddEventInput,
  type CalendarEvent,
  type CalendarKind,
  type CalendarRange,
  type CalendarSource,
  type UpdateEventPatch
} from './types';

export interface CalendarStore {
  load(): Promise<void>;
  add(input: AddEventInput): Promise<CalendarEvent>;
  update(id: string, patch: UpdateEventPatch): Promise<CalendarEvent | undefined>;
  remove(id: string): Promise<boolean>;
  list(range?: CalendarRange): CalendarEvent[];
  all(): CalendarEvent[];
  find(id: string): CalendarEvent | undefined;
  overlaps(start: string, end: string, excludeId?: string): CalendarEvent[];
  replaceSource(source: CalendarSource, events: AddEventInput[]): Promise<void>;
}

const KINDS: CalendarKind[] = ['meeting', 'focus', 'personal', 'reminder', 'away'];

function isRecord(value: unknown): value is Record<string, unknown> {
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

function pickRemind(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

function parseEvent(value: unknown): CalendarEvent | undefined {
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

function isLocal(source: CalendarSource): boolean {
  return source === 'local';
}

function overlapsRange(event: CalendarEvent, startMs: number, endMs: number): boolean {
  const eventStart = Date.parse(event.start);
  const eventEnd = Date.parse(event.end);
  if (Number.isNaN(eventStart) || Number.isNaN(eventEnd)) {
    return false;
  }
  return eventStart < endMs && eventEnd > startMs;
}

export interface CalendarStoreOptions {
  filePath: string;
  now: () => Date;
  mark?: TimingMark;
}

export function createCalendarStore(options: CalendarStoreOptions): CalendarStore {
  let events: CalendarEvent[] = [];
  let loadPromise: Promise<void> | undefined;
  let chain: Promise<unknown> = Promise.resolve();

  function exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = chain.then(task);
    chain = result.catch(() => undefined);
    return result;
  }

  async function readFromDisk(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(options.filePath, 'utf8');
    } catch {
      return;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      const list = isRecord(parsed) && Array.isArray(parsed.events) ? parsed.events : [];
      events = list.map(parseEvent).filter((event): event is CalendarEvent => event !== undefined);
    } catch {
      // Повреждённый файл не роняет ядро: пустой календарь и строка в журнале.
      events = [];
      options.mark?.('calendar.corrupt', { file: options.filePath });
    }
  }

  async function save(): Promise<void> {
    await mkdir(dirname(options.filePath), { recursive: true });
    const temporary = `${options.filePath}.tmp`;
    await writeFile(temporary, JSON.stringify({ events }, null, 2), 'utf8');
    await rename(temporary, options.filePath);
  }

  function load(): Promise<void> {
    if (loadPromise === undefined) {
      loadPromise = readFromDisk();
    }
    return loadPromise;
  }

  function sorted(range?: CalendarRange): CalendarEvent[] {
    const fromMs = range?.from === undefined ? undefined : Date.parse(range.from);
    const toMs = range?.to === undefined ? undefined : Date.parse(range.to);
    return events
      .filter((event) => {
        if (fromMs === undefined || toMs === undefined || Number.isNaN(fromMs) || Number.isNaN(toMs)) {
          return true;
        }
        return overlapsRange(event, fromMs, toMs);
      })
      .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  }

  function build(input: AddEventInput): CalendarEvent {
    const now = options.now().toISOString();
    const event: CalendarEvent = {
      id: randomUUID(),
      title: input.title.trim(),
      start: input.start,
      end: input.end,
      allDay: input.allDay === true,
      kind: input.kind ?? 'meeting',
      source: input.source ?? 'local',
      remindMinutes: pickRemind(input.remindMinutes),
      updatedAt: now
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

  return {
    load,

    add(input: AddEventInput): Promise<CalendarEvent> {
      return exclusive(async () => {
        await load();
        const event = build(input);
        events.push(event);
        await save();
        return event;
      });
    },

    update(id: string, patch: UpdateEventPatch): Promise<CalendarEvent | undefined> {
      return exclusive(async () => {
        await load();
        const event = events.find((item) => item.id === id);
        if (event === undefined || event.source === 'schedule') {
          return undefined;
        }
        if (!isLocal(event.source)) {
          // Загруженное событие человек не правит: только напоминание и заметку.
          if (patch.remindMinutes !== undefined) {
            event.remindMinutes = pickRemind(patch.remindMinutes);
          }
          if (patch.note !== undefined) {
            event.note = patch.note;
          }
          event.updatedAt = options.now().toISOString();
          await save();
          return event;
        }
        if (patch.title !== undefined) {
          event.title = patch.title.trim();
        }
        if (patch.start !== undefined) {
          event.start = patch.start;
        }
        if (patch.end !== undefined) {
          event.end = patch.end;
        }
        if (patch.allDay !== undefined) {
          event.allDay = patch.allDay;
        }
        if (patch.kind !== undefined) {
          event.kind = patch.kind;
        }
        if (patch.location !== undefined) {
          event.location = patch.location;
        }
        if (patch.link !== undefined) {
          event.link = patch.link;
        }
        if (patch.note !== undefined) {
          event.note = patch.note;
        }
        if (patch.remindMinutes !== undefined) {
          event.remindMinutes = pickRemind(patch.remindMinutes);
        }
        event.updatedAt = options.now().toISOString();
        await save();
        return event;
      });
    },

    remove(id: string): Promise<boolean> {
      return exclusive(async () => {
        await load();
        const event = events.find((item) => item.id === id);
        if (event === undefined || !isLocal(event.source)) {
          return false;
        }
        events = events.filter((item) => item.id !== id);
        await save();
        return true;
      });
    },

    list(range?: CalendarRange): CalendarEvent[] {
      return sorted(range);
    },

    all(): CalendarEvent[] {
      return sorted();
    },

    find(id: string): CalendarEvent | undefined {
      return events.find((item) => item.id === id);
    },

    overlaps(start: string, end: string, excludeId?: string): CalendarEvent[] {
      const startMs = Date.parse(start);
      const endMs = Date.parse(end);
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
        return [];
      }
      return sorted().filter(
        (event) => event.id !== excludeId && overlapsRange(event, startMs, endMs)
      );
    },

    replaceSource(source: CalendarSource, incoming: AddEventInput[]): Promise<void> {
      return exclusive(async () => {
        await load();
        events = events.filter((event) => event.source !== source);
        for (const input of incoming) {
          events.push(build({ ...input, source }));
        }
        await save();
      });
    }
  };
}
