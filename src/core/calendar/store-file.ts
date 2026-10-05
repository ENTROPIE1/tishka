import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { TimingMark } from '../../main/timing-log';
import { isRecord, parseEvent } from './event-codec';
import type { CalendarEvent } from './types';

// Повреждённый файл не роняет ядро: пустой календарь и строка в журнале.
export async function readEvents(filePath: string, mark?: TimingMark): Promise<CalendarEvent[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    const list = isRecord(parsed) && Array.isArray(parsed.events) ? parsed.events : [];
    return list.map(parseEvent).filter((event): event is CalendarEvent => event !== undefined);
  } catch {
    mark?.('calendar.corrupt', { file: filePath });
    return [];
  }
}

export async function writeEvents(filePath: string, events: CalendarEvent[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  await writeFile(temporary, JSON.stringify({ events }, null, 2), 'utf8');
  await rename(temporary, filePath);
}
