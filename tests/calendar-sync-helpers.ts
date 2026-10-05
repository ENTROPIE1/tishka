import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildEvent } from '../src/core/calendar/event-codec';
import { createCalendarStore, type CalendarStore } from '../src/core/calendar/store';
import { createCalendarSync, type CalendarSync } from '../src/core/calendar/sync';
import { defaultCalendarConfig } from '../src/core/calendar/types';
import { createEventBus } from '../src/core/events';
import { createToolRegistry, type MutableToolRegistry } from '../src/core/tools/registry';
import type { McpServerConfig } from '../src/core/types';

export const EXCHANGE_SERVER: McpServerConfig = {
  name: 'work',
  transport: 'stdio',
  command: 'node',
  args: ['mcp-servers/exchange/dist/index.js']
};

export interface SyncMeeting {
  id?: string;
  subject: string;
  start: string;
  end: string;
  location?: string;
  joinUrl?: string;
  allDay?: boolean;
  cancelled?: boolean;
}

export interface Harness {
  store: CalendarStore;
  registry: MutableToolRegistry;
  meetings: SyncMeeting[];
  calls: number;
  fail: string | undefined;
  changes: number;
  sync: CalendarSync;
  dir: string;
}

export function meeting(patch: Partial<SyncMeeting> = {}): SyncMeeting {
  return {
    id: 'm1',
    subject: 'Планёрка',
    start: '2026-10-07T11:00:00.000Z',
    end: '2026-10-07T12:00:00.000Z',
    location: 'Переговорка 1',
    joinUrl: 'https://meet.example/abc',
    ...patch
  };
}

export async function harness(
  meetings: SyncMeeting[],
  sources: Record<string, boolean> = { work: true },
  now: () => Date = () => new Date('2026-10-07T10:00:00')
): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'tishka-cal-sync-'));
  const store = createCalendarStore({ filePath: join(dir, 'calendar.json'), now });
  await store.load();
  const registry = createToolRegistry(createEventBus());
  const h: Harness = {
    store,
    registry,
    meetings,
    calls: 0,
    fail: undefined,
    changes: 0,
    dir,
    sync: undefined as unknown as CalendarSync
  };
  registry.register(
    { name: 'work__list_meetings', description: '', inputSchema: {}, source: 'mcp:work', readOnly: true },
    async () => {
      h.calls += 1;
      if (h.fail !== undefined) {
        return { ok: false, content: '', error: h.fail };
      }
      return { ok: true, content: '', data: { meetings: h.meetings } };
    }
  );
  h.sync = createCalendarSync({
    store,
    registry,
    now,
    config: () => ({ ...defaultCalendarConfig(), sources }),
    servers: () => [EXCHANGE_SERVER],
    emitChanged: () => {
      h.changes += 1;
    }
  });
  return h;
}

export async function cleanup(h: Harness): Promise<void> {
  h.sync.stop();
  await rm(h.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

// Хранилище в памяти: в тесте расписания нужны только микрозадачи, без записи файла.
export function memoryStore(now: () => Date): CalendarStore {
  let events = [] as ReturnType<typeof buildEvent>[];
  return {
    load: async () => undefined,
    add: async (input) => {
      const event = buildEvent(input, now());
      events.push(event);
      return event;
    },
    update: async () => undefined,
    remove: async () => false,
    list: () => events,
    all: () => events,
    find: (id) => events.find((event) => event.id === id),
    overlaps: () => [],
    replaceSource: async (source, incoming) => {
      events = events.filter((event) => event.source !== source);
      for (const input of incoming) {
        events.push(buildEvent({ ...input, source }, now()));
      }
    }
  };
}
