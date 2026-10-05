import type {
  ToolRegistry
} from '../types';
import type { TimingMark } from '../../main/timing-log';
import { describeConnection } from '../connections';
import type { McpServerConfig } from '../types';
import { isWorkTime } from './situation';
import type { CalendarStore } from './store';
import { toLocalIso } from './time';
import type { AddEventInput, CalendarConfig, CalendarEvent, CalendarSource } from './types';

export interface SyncMeeting {
  subject: string;
  start: string;
  end: string;
  location?: string;
  joinUrl?: string;
  id?: string;
  allDay?: boolean;
  cancelled?: boolean;
}

export interface CalendarSyncResult {
  ok: boolean;
  added: number;
  updated: number;
  removed: number;
  error?: string;
}

export interface SourceState extends CalendarSyncResult {
  loadedAt?: string;
}

export interface CalendarSyncDeps {
  store: CalendarStore;
  registry: ToolRegistry;
  now: () => Date;
  config: () => CalendarConfig;
  servers: () => McpServerConfig[];
  mark?: TimingMark;
  emitChanged?: () => void;
}

export interface CalendarSync {
  sync(): Promise<CalendarSyncResult>;
  start(): void;
  stop(): void;
  state(): Record<string, SourceState>;
}

const SYNC_DAYS = 14;
const WORK_INTERVAL_MS = 10 * 60_000;
const REST_INTERVAL_MS = 30 * 60_000;

function dateArg(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function exchangeServers(servers: McpServerConfig[]): McpServerConfig[] {
  return servers.filter((server) => describeConnection(server).template === 'exchange');
}

function externalIdOf(server: string, meeting: SyncMeeting): string {
  return meeting.id !== undefined && meeting.id !== ''
    ? meeting.id
    : `${server}:${meeting.start}:${meeting.subject}`;
}

function toInput(server: string, meeting: SyncMeeting, existing?: CalendarEvent): AddEventInput {
  const source: CalendarSource = `exchange:${server}`;
  const input: AddEventInput = {
    title: meeting.subject.trim() === '' ? 'Встреча' : meeting.subject,
    start: meeting.start,
    end: meeting.end,
    allDay: meeting.allDay === true,
    kind: 'meeting',
    source,
    externalId: externalIdOf(server, meeting)
  };
  if (meeting.location !== undefined && meeting.location !== '') {
    input.location = meeting.location;
  }
  if (meeting.joinUrl !== undefined && meeting.joinUrl !== '') {
    input.link = meeting.joinUrl;
  }
  if (existing !== undefined) {
    input.note = existing.note;
    input.remindMinutes = existing.remindMinutes;
  }
  return input;
}

function signature(input: AddEventInput): string {
  return JSON.stringify([input.externalId, input.title, input.start, input.end, input.allDay, input.location ?? '', input.link ?? '']);
}

function listSignature(inputs: AddEventInput[]): string {
  return inputs.map(signature).sort().join('|');
}

export function createCalendarSync(deps: CalendarSyncDeps): CalendarSync {
  const states: Record<string, SourceState> = {};
  let timer: ReturnType<typeof setInterval> | undefined;
  let lastSync = 0;

  async function syncSource(server: string, config: CalendarConfig): Promise<CalendarSyncResult> {
    const source: CalendarSource = `exchange:${server}`;
    const tool = `${server}__list_meetings`;
    const result = await deps.registry.call(tool, { date: dateArg(deps.now()), days: SYNC_DAYS }, { background: true });
    if (!result.ok) {
      return { ok: false, added: 0, updated: 0, removed: 0, error: result.error ?? 'Не удалось получить встречи' };
    }
    const data = result.data as { meetings?: SyncMeeting[] } | undefined;
    const meetings = (data?.meetings ?? []).filter((meeting) => meeting.cancelled !== true);

    const current = deps.store.all().filter((event) => event.source === source);
    const byExternal = new Map(current.map((event) => [event.externalId ?? event.id, event]));
    const desired = meetings.map((meeting) => toInput(server, meeting, byExternal.get(externalIdOf(server, meeting))));

    if (listSignature(desired) === listSignature(current.map((event) => ({
      title: event.title,
      start: event.start,
      end: event.end,
      allDay: event.allDay,
      source,
      externalId: event.externalId,
      location: event.location,
      link: event.link,
      remindMinutes: event.remindMinutes
    })))) {
      return { ok: true, added: 0, updated: 0, removed: 0 };
    }

    const desiredIds = new Set(desired.map((input) => input.externalId));
    const currentIds = new Set(current.map((event) => event.externalId ?? event.id));
    const added = desired.filter((input) => !currentIds.has(input.externalId ?? '')).length;
    const removed = current.filter((event) => !desiredIds.has(event.externalId ?? event.id)).length;
    const updated = desired.length - added;

    await deps.store.replaceSource(source, desired);
    void config;
    return { ok: true, added, updated, removed };
  }

  async function sync(): Promise<CalendarSyncResult> {
    const config = deps.config();
    const sources = config.sources ?? {};
    const servers = exchangeServers(deps.servers()).filter((server) => sources[server.name] === true);
    deps.mark?.('calendar.sync.start', { sources: servers.length });
    const startedAt = deps.now().getTime();
    let total: CalendarSyncResult = { ok: true, added: 0, updated: 0, removed: 0 };
    for (const server of servers) {
      try {
        const result = await syncSource(server.name, config);
        states[server.name] = { ...result, loadedAt: deps.now().toISOString() };
        total = {
          ok: total.ok && result.ok,
          added: total.added + result.added,
          updated: total.updated + result.updated,
          removed: total.removed + result.removed,
          error: result.error ?? total.error
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        states[server.name] = { ok: false, added: 0, updated: 0, removed: 0, error: message, loadedAt: deps.now().toISOString() };
        total.ok = false;
        total.error = message;
      }
    }
    if (total.added + total.updated + total.removed > 0) {
      deps.emitChanged?.();
    }
    lastSync = deps.now().getTime();
    deps.mark?.('calendar.sync.end', {
      ok: total.ok,
      added: total.added,
      updated: total.updated,
      removed: total.removed,
      ms: deps.now().getTime() - startedAt
    });
    return total;
  }

  return {
    sync,

    start(): void {
      if (timer !== undefined) {
        return;
      }
      timer = setInterval(() => {
        const config = deps.config();
        const gap = isWorkTime(config, deps.now()) ? WORK_INTERVAL_MS : REST_INTERVAL_MS;
        if (deps.now().getTime() - lastSync >= gap) {
          void sync();
        }
      }, 60_000);
    },

    stop(): void {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    },

    state(): Record<string, SourceState> {
      return { ...states };
    }
  };
}

export function exchangeSourceName(name: string): string {
  return `exchange:${name}`;
}

export function todayIso(date: Date): string {
  return toLocalIso(date);
}
