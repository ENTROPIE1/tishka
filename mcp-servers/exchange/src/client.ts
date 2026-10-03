import { XMLParser } from 'fast-xml-parser';
import httpntlm from 'httpntlm';

export interface Meeting {
  subject: string;
  start: string;
  end: string;
  location: string;
  organizer: string;
  joinUrl?: string;
}

export type EwsPost = (
  url: string,
  soapBody: string,
  auth: { user: string; password: string }
) => Promise<{ status: number; body: string }>;

export interface ExchangeClient {
  listMeetings(from: Date, to: Date): Promise<Meeting[]>;
}

const REQUEST_TIMEOUT_MS = 30_000;
const NO_ERROR = 'NoError';
const FAULT_LIMIT = 300;
const SECRET_PLACEHOLDER = '[скрыто]';

const XML_PARSER = new XMLParser({ removeNSPrefix: true });

export function createExchangeClient(opts: {
  ewsUrl: string;
  user: string;
  password: string;
  post?: EwsPost;
}): ExchangeClient {
  const post = opts.post ?? ntlmPost;

  return {
    async listMeetings(from: Date, to: Date): Promise<Meeting[]> {
      const response = await postWithTimeout(
        opts.ewsUrl,
        buildFindItemSoap(from, to),
        { user: opts.user, password: opts.password },
        post
      );
      const message = readResponseMessage(response, {
        user: opts.user,
        password: opts.password
      });
      return asArray(message.RootFolder?.Items?.CalendarItem)
        .map(toMeeting)
        .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    }
  };
}

// сюда попадает и срабатывание таймаута: зависший запрос неотличим от отказа сети
async function postWithTimeout(
  url: string,
  soapBody: string,
  auth: { user: string; password: string },
  post: EwsPost
): Promise<{ status: number; body: string }> {
  try {
    return await withTimeout(post(url, soapBody, auth), REQUEST_TIMEOUT_MS);
  } catch (error) {
    throw new Error('Почтовый сервер недоступен, проверьте VPN', { cause: error });
  }
}

function readResponseMessage(
  response: { status: number; body: string },
  auth: { user: string; password: string }
): RawResponseMessage {
  if (response.status === 401) {
    throw new Error('Exchange отклонил логин или пароль');
  }
  if (response.status !== 200) {
    throw new Error(describeStatusError(response, auth));
  }
  let parsed: RawEnvelope;
  try {
    parsed = XML_PARSER.parse(response.body) as RawEnvelope;
  } catch (error) {
    throw new Error('Exchange вернул некорректный ответ', { cause: error });
  }
  const message = asArray(
    parsed.Envelope?.Body?.FindItemResponse?.ResponseMessages?.FindItemResponseMessage
  )[0];
  if (message === undefined) {
    throw new Error('Exchange вернул некорректный ответ');
  }
  const code = asText(message.ResponseCode);
  if (code !== NO_ERROR) {
    throw new Error(`Exchange вернул код ошибки: ${code}`);
  }
  return message;
}

function describeStatusError(
  response: { status: number; body: string },
  auth: { user: string; password: string }
): string {
  const fault = readFault(response.body);
  const parts: string[] = [];
  if (fault.text !== '') {
    parts.push(truncate(sanitizeSecrets(fault.text, auth)));
  }
  if (fault.responseCode !== '') {
    parts.push(`ResponseCode: ${truncate(sanitizeSecrets(fault.responseCode, auth))}`);
  }
  if (parts.length === 0) {
    return `Exchange вернул статус ${response.status}`;
  }
  return `Exchange вернул статус ${response.status}: ${parts.join('; ')}`;
}

function readFault(body: string): { text: string; responseCode: string } {
  let parsed: RawFaultEnvelope;
  try {
    parsed = XML_PARSER.parse(body) as RawFaultEnvelope;
  } catch {
    return { text: '', responseCode: '' };
  }
  const fault = parsed.Envelope?.Body?.Fault;
  if (fault === undefined) {
    return { text: '', responseCode: '' };
  }
  return {
    text: asText(fault.faultstring) || asText(fault.Reason?.Text),
    responseCode: asText(fault.detail?.ResponseCode) || asText(fault.Detail?.ResponseCode)
  };
}

// сначала убираем секреты: обрезка не должна оставить часть пароля в тексте
function sanitizeSecrets(text: string, auth: { user: string; password: string }): string {
  let result = text;
  if (auth.password.length > 0) {
    result = result.split(auth.password).join(SECRET_PLACEHOLDER);
  }
  if (auth.user.length > 0) {
    result = result.split(auth.user).join(SECRET_PLACEHOLDER);
  }
  return result;
}

function truncate(text: string): string {
  return text.slice(0, FAULT_LIMIT);
}

function buildFindItemSoap(from: Date, to: Date): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types">
  <soap:Header>
    <t:RequestServerVersion Version="Exchange2013" />
  </soap:Header>
  <soap:Body>
    <m:FindItem Traversal="Shallow">
      <m:ItemShape>
        <t:BaseShape>IdOnly</t:BaseShape>
        <t:AdditionalProperties>
          <t:FieldURI FieldURI="item:Subject" />
          <t:FieldURI FieldURI="calendar:Start" />
          <t:FieldURI FieldURI="calendar:End" />
          <t:FieldURI FieldURI="calendar:Location" />
          <t:FieldURI FieldURI="calendar:Organizer" />
        </t:AdditionalProperties>
      </m:ItemShape>
      <m:CalendarView StartDate="${from.toISOString()}" EndDate="${to.toISOString()}" />
      <m:ParentFolderIds>
        <t:DistinguishedFolderId Id="calendar" />
      </m:ParentFolderIds>
    </m:FindItem>
  </soap:Body>
</soap:Envelope>`;
}

async function ntlmPost(
  url: string,
  soapBody: string,
  auth: { user: string; password: string }
): Promise<{ status: number; body: string }> {
  const { domain, username } = splitUser(auth.user);
  const response = await new Promise<{ statusCode: number; body: string | Buffer }>(
    (resolve, reject) => {
      httpntlm.post(
        {
          url,
          username,
          password: auth.password,
          domain,
          body: soapBody,
          headers: { 'Content-Type': 'text/xml; charset=utf-8' },
          timeout: REQUEST_TIMEOUT_MS
        },
        (error, result) => {
          if (error !== null) {
            reject(error);
            return;
          }
          resolve(result);
        }
      );
    }
  );
  return { status: response.statusCode, body: asBodyText(response.body) };
}

export function splitUser(user: string): { domain: string; username: string } {
  const separator = user.indexOf('\\');
  if (separator === -1) {
    return { domain: '', username: user };
  }
  return { domain: user.slice(0, separator), username: user.slice(separator + 1) };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Превышен таймаут запроса')), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function asBodyText(body: string | Buffer): string {
  return typeof body === 'string' ? body : body.toString('utf-8');
}

function toMeeting(item: RawCalendarItem): Meeting {
  const location = asText(item.Location);
  const meeting: Meeting = {
    subject: asText(item.Subject),
    start: toIso(item.Start),
    end: toIso(item.End),
    location,
    organizer: asText(item.Organizer?.Mailbox?.Name) || asText(item.Organizer?.Mailbox?.EmailAddress)
  };
  const joinUrl = findJoinUrl(location);
  if (joinUrl !== undefined) {
    meeting.joinUrl = joinUrl;
  }
  return meeting;
}

function toIso(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function findJoinUrl(location: string): string | undefined {
  const match = /https:\/\/\S+/.exec(location);
  return match === null ? undefined : match[0];
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

interface RawMailbox {
  Name?: unknown;
  EmailAddress?: unknown;
}

interface RawCalendarItem {
  Subject?: unknown;
  Start?: unknown;
  End?: unknown;
  Location?: unknown;
  Organizer?: { Mailbox?: RawMailbox };
}

interface RawResponseMessage {
  ResponseCode?: unknown;
  RootFolder?: { Items?: { CalendarItem?: RawCalendarItem | RawCalendarItem[] } };
}

interface RawEnvelope {
  Envelope?: {
    Body?: {
      FindItemResponse?: {
        ResponseMessages?: {
          FindItemResponseMessage?: RawResponseMessage | RawResponseMessage[];
        };
      };
    };
  };
}

interface RawFault {
  faultstring?: unknown;
  Reason?: { Text?: unknown };
  detail?: { ResponseCode?: unknown };
  Detail?: { ResponseCode?: unknown };
}

interface RawFaultEnvelope {
  Envelope?: { Body?: { Fault?: RawFault } };
}
