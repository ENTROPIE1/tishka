import { ipcMain } from 'electron';
import type { CalendarService } from '../core/app';
import type { CalendarSyncResult, SourceState } from '../core/calendar/sync';
import type { AddEventInput, CalendarEvent, CalendarRange, UpdateEventPatch } from '../core/calendar/types';
import {
  CALENDAR_ADD_CHANNEL,
  CALENDAR_EVENTS_CHANNEL,
  CALENDAR_FREE_CHANNEL,
  CALENDAR_REMOVE_CHANNEL,
  CALENDAR_STATUS_CHANNEL,
  CALENDAR_SYNC_CHANNEL,
  CALENDAR_SYNC_STATE_CHANNEL,
  CALENDAR_UPDATE_CHANNEL
} from './ipc-channels';

export type { CalendarSyncResult, SourceState } from '../core/calendar/sync';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rangeArg(value: unknown): CalendarRange | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const range: CalendarRange = {};
  if (typeof value.from === 'string') {
    range.from = value.from;
  }
  if (typeof value.to === 'string') {
    range.to = value.to;
  }
  return range;
}

export interface CalendarIpcDeps {
  calendar: () => CalendarService;
}

export function registerCalendarIpc(deps: CalendarIpcDeps): void {
  ipcMain.handle(CALENDAR_EVENTS_CHANNEL, (_event, value: unknown): Promise<CalendarEvent[]> =>
    deps.calendar().events(rangeArg(value))
  );

  ipcMain.handle(CALENDAR_ADD_CHANNEL, (_event, value: unknown): Promise<CalendarEvent> => {
    if (!isRecord(value)) {
      throw new Error('Событие должно быть объектом');
    }
    return deps.calendar().add(value as unknown as AddEventInput);
  });

  ipcMain.handle(CALENDAR_UPDATE_CHANNEL, (_event, value: unknown): Promise<CalendarEvent | undefined> => {
    if (!isRecord(value) || typeof value.id !== 'string') {
      return Promise.resolve(undefined);
    }
    const { id, ...patch } = value;
    return deps.calendar().update(id, patch as UpdateEventPatch);
  });

  ipcMain.handle(CALENDAR_REMOVE_CHANNEL, (_event, id: unknown): Promise<boolean> =>
    typeof id === 'string' ? deps.calendar().remove(id) : Promise.resolve(false)
  );

  ipcMain.handle(CALENDAR_FREE_CHANNEL, (_event, value: unknown) => {
    if (!isRecord(value)) {
      return Promise.resolve([]);
    }
    const day = typeof value.day === 'string' ? value.day : undefined;
    const duration = typeof value.durationMinutes === 'number' ? value.durationMinutes : 30;
    return deps.calendar().free(day, duration);
  });

  ipcMain.handle(CALENDAR_STATUS_CHANNEL, () => deps.calendar().situation());

  ipcMain.handle(CALENDAR_SYNC_CHANNEL, async (_event, value: unknown): Promise<CalendarSyncResult> => {
    const enable = isRecord(value) && typeof value.enable === 'boolean' ? value.enable : undefined;
    return deps.calendar().sync(enable);
  });

  ipcMain.handle(CALENDAR_SYNC_STATE_CHANNEL, (): Record<string, SourceState> =>
    deps.calendar().syncState()
  );
}
