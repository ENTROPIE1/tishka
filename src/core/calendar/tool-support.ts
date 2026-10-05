import type { Panel, ToolResult } from '../types';
import { eventSubtitle, eventTimeLabel, resolveRange } from './format';
import { parseWhen, type ParsedWhen } from './parse';
import type { CalendarStore } from './store';
import type { CalendarSyncResult } from './sync';
import type { CalendarConfig, CalendarEvent, CalendarRange } from './types';
import { toLocalIso } from './time';

export interface CalendarToolDeps {
  store: CalendarStore;
  provider: () => Promise<CalendarEvent[]>;
  config: () => CalendarConfig;
  now: () => Date;
  emitChanged?: () => void;
  sync?: (enable?: boolean) => Promise<CalendarSyncResult>;
}

export function ok(content: string, data?: unknown, reply?: ToolResult['reply']): ToolResult {
  const result: ToolResult = { ok: true, content };
  if (data !== undefined) {
    result.data = data;
  }
  if (reply !== undefined) {
    result.reply = reply;
  }
  return result;
}

export function fail(error: string): ToolResult {
  return { ok: false, content: '', error };
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

export function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function parseInput(value: string, now: Date): ParsedWhen | undefined {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    const start = new Date(`${value.trim()}T00:00:00`);
    const end = new Date(start.getTime() + 86_400_000);
    return { start: toLocalIso(start), end: toLocalIso(end), allDay: true };
  }
  return parseWhen(value, now);
}

export function overlapping(events: CalendarEvent[], start: string, end: string, excludeId?: string): CalendarEvent[] {
  const from = Date.parse(start);
  const to = Date.parse(end);
  if (Number.isNaN(from) || Number.isNaN(to)) {
    return [];
  }
  return events.filter((event) => {
    if (event.id === excludeId || event.kind === 'reminder') {
      return false;
    }
    const s = Date.parse(event.start);
    const e = Date.parse(event.end);
    return !Number.isNaN(s) && !Number.isNaN(e) && s < to && e > from;
  });
}

export function rangeFrom(args: Record<string, unknown>, now: Date): CalendarRange | undefined {
  const from = str(args.from);
  const to = str(args.to);
  if (from !== undefined && to !== undefined) {
    return { from, to };
  }
  return resolveRange(str(args.period), now);
}

export function agendaPanel(range: CalendarRange, events: CalendarEvent[]): Panel {
  const title = range.from === undefined ? 'Календарь' : `Календарь: ${range.from.slice(0, 10)}`;
  return {
    kind: 'list',
    title,
    items: events.map((event) => ({ title: `${eventTimeLabel(event)} — ${event.title}`, subtitle: eventSubtitle(event) }))
  };
}

export function eventClock(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
