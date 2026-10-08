import {
  asArray,
  asBool,
  asText,
  createEwsTransport,
  toIso,
  type EwsPost,
  type RawResponseMessage
} from './ews';

export { splitUser, type EwsPost } from './ews';

export interface Meeting {
  subject: string;
  start: string;
  end: string;
  location: string;
  organizer: string;
  joinUrl?: string;
  id?: string;          // идентификатор встречи в Exchange
  allDay?: boolean;     // встреча на весь день
  cancelled?: boolean;  // отменена организатором
}

export interface MeetingDraftInput {
  subject: string;
  start: Date;
  end: Date;
  location?: string;
  body?: string;
  attendees: string[];
}

export interface ExchangeClient {
  listMeetings(from: Date, to: Date): Promise<Meeting[]>;
  createMeetingDraft(input: MeetingDraftInput): Promise<{ id: string }>;
}

export function createExchangeClient(opts: {
  ewsUrl: string;
  user: string;
  password: string;
  post?: EwsPost;
}): ExchangeClient {
  const ews = createEwsTransport(opts);

  return {
    async listMeetings(from: Date, to: Date): Promise<Meeting[]> {
      const message = await ews.call(buildFindItemSoap(from, to), 'FindItem');
      return readCalendarItems(message)
        .map(toMeeting)
        .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    },
    async createMeetingDraft(input: MeetingDraftInput): Promise<{ id: string }> {
      const message = await ews.call(buildCreateItemSoap(input), 'CreateItem');
      const id = readCreatedItemId(message);
      if (id === '') {
        throw new Error('Exchange не вернул идентификатор черновика встречи');
      }
      return { id };
    }
  };
}

function readCalendarItems(message: RawResponseMessage): RawCalendarItem[] {
  return asArray(
    message.RootFolder?.Items?.CalendarItem as RawCalendarItem | RawCalendarItem[] | undefined
  );
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
          <t:FieldURI FieldURI="calendar:IsAllDayEvent" />
          <t:FieldURI FieldURI="calendar:IsCancelled" />
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
  const id = asText(item.ItemId?.['@_Id']);
  if (id !== '') {
    meeting.id = id;
  }
  if (asBool(item.IsAllDayEvent)) {
    meeting.allDay = true;
  }
  if (asBool(item.IsCancelled)) {
    meeting.cancelled = true;
  }
  return meeting;
}

function findJoinUrl(location: string): string | undefined {
  const match = /https:\/\/\S+/.exec(location);
  return match === null ? undefined : match[0];
}

function xmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildCreateItemSoap(input: MeetingDraftInput): string {
  const attendees = input.attendees
    .map(
      (email) => `<t:Attendee><t:Mailbox><t:EmailAddress>${xmlText(email)}</t:EmailAddress></t:Mailbox></t:Attendee>`
    )
    .join('');
  const location =
    input.location !== undefined && input.location.trim() !== ''
      ? `<t:Location>${xmlText(input.location.trim())}</t:Location>`
      : '';
  const body =
    input.body !== undefined && input.body.trim() !== ''
      ? `<t:Body BodyType="Text">${xmlText(input.body.trim())}</t:Body>`
      : '';
  const required =
    attendees === '' ? '' : `<t:RequiredAttendees>${attendees}</t:RequiredAttendees>`;
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types">
  <soap:Header>
    <t:RequestServerVersion Version="Exchange2013" />
  </soap:Header>
  <soap:Body>
    <m:CreateItem SendMeetingInvitations="SendToNone">
      <m:Items>
        <t:CalendarItem>
          <t:Subject>${xmlText(input.subject)}</t:Subject>
          ${body}
          <t:Start>${input.start.toISOString()}</t:Start>
          <t:End>${input.end.toISOString()}</t:End>
          ${location}
          ${required}
        </t:CalendarItem>
      </m:Items>
    </m:CreateItem>
  </soap:Body>
</soap:Envelope>`;
}

function readCreatedItemId(message: RawResponseMessage): string {
  const items = message.Items as { CalendarItem?: RawCalendarItem | RawCalendarItem[] } | undefined;
  const item = asArray(items?.CalendarItem)[0];
  return asText(item?.ItemId?.['@_Id']);
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
  ItemId?: { '@_Id'?: unknown };
  IsAllDayEvent?: unknown;
  IsCancelled?: unknown;
}
