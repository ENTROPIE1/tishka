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
