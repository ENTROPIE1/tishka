export interface MailDraftParams {
  to?: string;
  subject?: string;
  body?: string;
}

export interface MeetingDraftParams {
  subject?: string;
  start: string;
  end: string;
  location?: string;
  body?: string;
}

export function mailDraftLink(owaUrl: string, params: MailDraftParams): string {
  return buildLink(
    owaUrl,
    '/mail/action/compose',
    presentEntries([
      ['to', params.to],
      ['subject', params.subject],
      ['body', params.body]
    ])
  );
}

export function meetingDraftLink(owaUrl: string, params: MeetingDraftParams): string {
  return buildLink(
    owaUrl,
    '/calendar/action/compose',
    presentEntries([
      ['subject', params.subject],
      ['startdt', toLocalStamp(params.start)],
      ['enddt', toLocalStamp(params.end)],
      ['location', params.location],
      ['body', params.body]
    ])
  );
}

function presentEntries(entries: [string, string | undefined][]): [string, string][] {
  const present: [string, string][] = [];
  for (const [name, value] of entries) {
    if (value !== undefined && value.trim() !== '') {
      present.push([name, value]);
    }
  }
  return present;
}

function buildLink(owaUrl: string, path: string, entries: [string, string][]): string {
  const base = `${owaUrl.replace(/\/+$/, '')}/`;
  const query = entries.map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('&');
  return query.length > 0 ? `${base}?path=${path}&${query}` : `${base}?path=${path}`;
}

function toLocalStamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Некорректная дата: ${value}`);
  }
  const pad = (part: number): string => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
