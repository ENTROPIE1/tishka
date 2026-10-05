import { atTime, parseMinutes, toLocalIso, weekdayOf } from './time';
import type { CalendarConfig, CalendarEvent, CalendarKind } from './types';

const BUSY: CalendarKind[] = ['meeting', 'focus', 'personal', 'away'];
const MINUTE_MS = 60_000;

interface Block {
  start: number;
  end: number;
}

function busyBlocks(events: CalendarEvent[], dayStart: number, dayEnd: number): Block[] {
  const blocks: Block[] = [];
  for (const event of events) {
    if (!BUSY.includes(event.kind)) {
      continue;
    }
    const start = Math.max(Date.parse(event.start), dayStart);
    const end = Math.min(Date.parse(event.end), dayEnd);
    if (!Number.isNaN(start) && !Number.isNaN(end) && start < end) {
      blocks.push({ start, end });
    }
  }
  return blocks.sort((a, b) => a.start - b.start);
}

function merge(blocks: Block[]): Block[] {
  const result: Block[] = [];
  for (const block of blocks) {
    const last = result[result.length - 1];
    if (last !== undefined && block.start <= last.end) {
      last.end = Math.max(last.end, block.end);
    } else {
      result.push({ ...block });
    }
  }
  return result;
}

// Свободные окна в рабочее время дня короче заданной длительности отбрасываются.
export function freeWindows(
  events: CalendarEvent[],
  config: CalendarConfig,
  day: Date,
  durationMinutes: number
): { start: string; end: string }[] {
  const hours = config.workHours.days[weekdayOf(day)] ?? null;
  if (hours === null) {
    return [];
  }
  const startMin = parseMinutes(hours.start);
  const endMin = parseMinutes(hours.end);
  if (startMin === undefined || endMin === undefined || endMin <= startMin) {
    return [];
  }
  const dayStart = atTime(day, startMin);
  const dayEnd = atTime(day, endMin);
  const need = Math.max(0, durationMinutes) * MINUTE_MS;
  const windows: { start: string; end: string }[] = [];
  let cursor = dayStart.getTime();
  for (const block of merge(busyBlocks(events, dayStart.getTime(), dayEnd.getTime()))) {
    if (block.start - cursor >= need) {
      windows.push({ start: toLocalIso(new Date(cursor)), end: toLocalIso(new Date(block.start)) });
    }
    cursor = Math.max(cursor, block.end);
  }
  if (dayEnd.getTime() - cursor >= need) {
    windows.push({ start: toLocalIso(new Date(cursor)), end: toLocalIso(dayEnd) });
  }
  return windows;
}
