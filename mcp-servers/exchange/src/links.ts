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
  to?: string;   // участники: адреса в поле «Люди», не в описание
}

export const DRAFT_URL_LIMIT = 2000;
export const LONG_BODY_HINT = 'Текст длинный — вставьте его в письмо из буфера';

export interface MailDraftResult {
  url: string;
  body: string;          // полный текст письма
  truncated: boolean;    // текст сокращён в ссылке
}

// Письмо с длинным текстом не влезает в адрес: текст в ссылке сокращается до
// предела, а полный текст возвращается рядом для карточки.
export function fitMailDraftLink(
  owaUrl: string,
  params: MailDraftParams,
  limit = DRAFT_URL_LIMIT
): MailDraftResult {
  const body = params.body ?? '';
  const full = mailDraftLink(owaUrl, params);
  if (full.length <= limit) {
    return { url: full, body, truncated: false };
  }
  const shortenedBody = fitFragment(body, (value) => mailDraftLink(owaUrl, { ...params, body: value }).length, limit);
  let result = mailDraftLink(owaUrl, { ...params, body: shortenedBody });
  if (result.length > limit && params.subject !== undefined) {
    const subject = fitFragment(params.subject, (value) => mailDraftLink(owaUrl, { ...params, subject: value, body: shortenedBody }).length, limit);
    result = mailDraftLink(owaUrl, { ...params, subject, body: shortenedBody });
  }
  return { url: result, body, truncated: true };
}

// Наибольший префикс строки, при котором адрес ещё укладывается в предел.
function fitFragment(value: string, lengthOf: (fragment: string) => number, limit: number): string {
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (lengthOf(prefix(value, middle)) <= limit) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return prefix(value, low);
}

// Префикс без разрезания суррогатной пары.
function prefix(value: string, length: number): string {
  if (length <= 0) {
    return '';
  }
  if (length >= value.length) {
    return value;
  }
  const code = value.charCodeAt(length - 1);
  const cut = code >= 0xd800 && code <= 0xdbff ? length - 1 : length;
  return value.slice(0, cut);
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

// Ссылка на письмо в веб-почте Outlook: открывает его по идентификатору EWS.
export function mailItemLink(owaUrl: string, itemId: string): string {
  return buildLink(owaUrl, '/mail/inbox', [['ItemID', itemId]]);
}

export function calendarItemLink(owaUrl: string, itemId: string): string {
  return buildLink(owaUrl, '/calendar/item', [['ItemID', itemId]]);
}

export function meetingDraftLink(owaUrl: string, params: MeetingDraftParams, now = new Date()): string {
  const start = parseMeetingInstant(params.start, now);
  let end = parseMeetingInstant(params.end ?? params.start, now);
  if (end.getTime() <= start.getTime()) {
    end = new Date(start.getTime() + 60 * 60 * 1000);
  }
  return buildLink(
    owaUrl,
    '/calendar/action/compose',
    presentEntries([
      ['to', attendeesParam(params.to)],
      ['subject', params.subject],
      ['startdt', formatLocalStamp(start)],
      ['enddt', formatLocalStamp(end)],
      ['location', params.location],
      ['body', params.body]
    ])
  );
}

function attendeesParam(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const emails = value.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g);
  if (emails !== null && emails.length > 0) {
    return emails.join(';');
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function attendeeEmails(value: string | undefined): string[] {
  const packed = attendeesParam(value);
  if (packed === undefined) {
    return [];
  }
  return packed.split(';').map((item) => item.trim()).filter((item) => item !== '');
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

function formatLocalStamp(date: Date): string {
  const pad = (part: number): string => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const WEEKDAY_RU: Record<string, number> = {
  воскресенье: 0,
  вс: 0,
  понедельник: 1,
  пн: 1,
  вторник: 2,
  вт: 2,
  среда: 3,
  ср: 3,
  четверг: 4,
  чт: 4,
  пятница: 5,
  пт: 5,
  суббота: 6,
  сб: 6
};

export function parseMeetingInstant(value: string, now = new Date()): Date {
  const trimmed = value.trim();
  const dated = trimmed.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2})[:.](\d{2})(?::(\d{2}))?)?$/);
  if (dated !== null) {
    const hour = dated[2] !== undefined ? Number(dated[2]) : 0;
    const minute = dated[3] !== undefined ? Number(dated[3]) : 0;
    const second = dated[4] !== undefined ? Number(dated[4]) : 0;
    const [year, month, day] = dated[1].split('-').map(Number);
    const local = new Date(year, month - 1, day, hour, minute, second);
    if (!Number.isNaN(local.getTime())) {
      return local;
    }
  }
  const weekdayTime = trimmed.match(
    /^(понедельник|вторник|среда|четверг|пятница|суббота|воскресенье|пн|вт|ср|чт|пт|сб|вс)\s+(\d{1,2})[:.](\d{2})$/i
  );
  if (weekdayTime !== null) {
    const weekday = WEEKDAY_RU[weekdayTime[1].toLowerCase()];
    const hour = Number(weekdayTime[2]);
    const minute = Number(weekdayTime[3]);
    if (weekday !== undefined) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0);
      let add = (weekday - day.getDay() + 7) % 7;
      if (add === 0 && (now.getHours() > hour || (now.getHours() === hour && now.getMinutes() >= minute))) {
        add = 7;
      }
      day.setDate(day.getDate() + add);
      return day;
    }
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }
  throw new Error(`Некорректная дата: ${value}`);
}
