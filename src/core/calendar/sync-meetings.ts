import { describeConnection } from '../connections';
import type { McpServerConfig } from '../types';
import type { AddEventInput, CalendarEvent, CalendarSource } from './types';

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

export function dateArg(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function exchangeServers(servers: McpServerConfig[]): McpServerConfig[] {
  return servers.filter((server) => describeConnection(server).template === 'exchange');
}

export function externalIdOf(server: string, meeting: SyncMeeting): string {
  return meeting.id !== undefined && meeting.id !== ''
    ? meeting.id
    : `${server}:${meeting.start}:${meeting.subject}`;
}

export function toInput(
  server: string,
  meeting: SyncMeeting,
  existing?: CalendarEvent,
  defaultRemind?: number
): AddEventInput {
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
  // Напоминание и заметку человека сохраняем: загрузка их не трогает.
  input.note = existing?.note;
  input.remindMinutes = existing !== undefined ? existing.remindMinutes : defaultRemind;
  return input;
}

export function eventToInput(event: CalendarEvent): AddEventInput {
  const input: AddEventInput = {
    title: event.title,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    source: event.source,
    externalId: event.externalId,
    remindMinutes: event.remindMinutes
  };
  if (event.location !== undefined) {
    input.location = event.location;
  }
  if (event.link !== undefined) {
    input.link = event.link;
  }
  return input;
}

export function inputSignature(input: AddEventInput): string {
  return JSON.stringify([input.externalId, input.title, input.start, input.end, input.allDay, input.location ?? '', input.link ?? '']);
}

export function listSignature(inputs: AddEventInput[]): string {
  return inputs.map(inputSignature).sort().join('|');
}
