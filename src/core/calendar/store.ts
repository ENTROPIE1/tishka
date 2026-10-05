import type { TimingMark } from '../../main/timing-log';
import { buildEvent, overlapsRange, pickRemind } from './event-codec';
import { readEvents, writeEvents } from './store-file';
import {
  type AddEventInput,
  type CalendarEvent,
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

function isLocal(source: CalendarSource): boolean {
  return source === 'local';
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

  async function load(): Promise<void> {
    if (loadPromise === undefined) {
      loadPromise = readEvents(options.filePath, options.mark).then((list) => {
        events = list;
      });
    }
    return loadPromise;
  }

  function save(): Promise<void> {
    return writeEvents(options.filePath, events);
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

  return {
    load,

    add(input: AddEventInput): Promise<CalendarEvent> {
      return exclusive(async () => {
        await load();
        const event = buildEvent(input, options.now());
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
          events.push(buildEvent({ ...input, source }, options.now()));
        }
        await save();
      });
    }
  };
}
