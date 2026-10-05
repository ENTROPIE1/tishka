import type { ToolRegistry } from '../types';
import type { TimingMark } from '../../main/timing-log';
import type { McpServerConfig } from '../types';
import { isWorkTime } from './situation';
import type { CalendarStore } from './store';
import {
  dateArg,
  eventToInput,
  exchangeServers,
  externalIdOf,
  inputSignature,
  listSignature,
  toInput,
  type SyncMeeting
} from './sync-meetings';
import { toLocalIso } from './time';
import type { CalendarConfig, CalendarSource } from './types';

export type { SyncMeeting } from './sync-meetings';

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

export function syncIntervalMs(isWork: boolean): number {
  return isWork ? WORK_INTERVAL_MS : REST_INTERVAL_MS;
}

// Время последней удачной загрузки не теряется при ошибке: источник
// показывает и её, и текст ошибки.
function withState(previous: SourceState | undefined, result: CalendarSyncResult, at: string): SourceState {
  const next: SourceState = { ...result };
  if (result.ok) {
    next.loadedAt = at;
  } else if (previous?.loadedAt !== undefined) {
    next.loadedAt = previous.loadedAt;
  }
  return next;
}

export function createCalendarSync(deps: CalendarSyncDeps): CalendarSync {
  const states: Record<string, SourceState> = {};
  let timer: ReturnType<typeof setInterval> | undefined;
  let lastSync = 0;
  let running = false;

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
    const desired = meetings.map((meeting) =>
      toInput(server, meeting, byExternal.get(externalIdOf(server, meeting)), config.defaultRemindMinutes)
    );

    if (listSignature(desired) === listSignature(current.map(eventToInput))) {
      return { ok: true, added: 0, updated: 0, removed: 0 };
    }

    const currentById = new Map(current.map((event) => [event.externalId ?? event.id, eventToInput(event)]));
    const desiredIds = new Set(desired.map((input) => input.externalId));
    let added = 0;
    let updated = 0;
    for (const input of desired) {
      const previous = currentById.get(input.externalId ?? '');
      if (previous === undefined) {
        added += 1;
      } else if (inputSignature(previous) !== inputSignature(input)) {
        updated += 1;
      }
    }
    const removed = current.filter((event) => !desiredIds.has(event.externalId ?? event.id)).length;

    await deps.store.replaceSource(source, desired);
    return { ok: true, added, updated, removed };
  }

  async function sync(): Promise<CalendarSyncResult> {
    if (running) {
      return { ok: true, added: 0, updated: 0, removed: 0 };
    }
    running = true;
    const config = deps.config();
    const sources = config.sources ?? {};
    const servers = exchangeServers(deps.servers()).filter((server) => sources[server.name] === true);
    deps.mark?.('calendar.sync.start', { sources: servers.length });
    const startedAt = deps.now().getTime();
    let total: CalendarSyncResult = { ok: true, added: 0, updated: 0, removed: 0 };
    try {
      for (const server of servers) {
        try {
          const result = await syncSource(server.name, config);
          states[server.name] = withState(states[server.name], result, deps.now().toISOString());
          total = {
            ok: total.ok && result.ok,
            added: total.added + result.added,
            updated: total.updated + result.updated,
            removed: total.removed + result.removed,
            error: result.error ?? total.error
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          states[server.name] = withState(
            states[server.name],
            { ok: false, added: 0, updated: 0, removed: 0, error: message },
            deps.now().toISOString()
          );
          total.ok = false;
          total.error = message;
        }
      }
    } finally {
      running = false;
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
        const gap = syncIntervalMs(isWorkTime(config, deps.now()));
        if (!running && deps.now().getTime() - lastSync >= gap) {
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
