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

export function toInput(server: string, meeting: SyncMeeting, existing?: CalendarEvent): AddEventInput {
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

export function listSignature(inputs: AddEventInput[]): string {
  return inputs.map(signature).sort().join('|');
}
