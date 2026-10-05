import type { MailFolder, MailSearch } from './mail-types';

export const FOLDERS: Record<MailFolder, string> = {
  inbox: 'inbox',
  sent: 'sentitems',
  drafts: 'drafts',
  all: 'msgfolderroot'
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}/;

export function buildAqs(params: MailSearch): string {
  const parts: string[] = [];
  if (params.query !== undefined && params.query.trim() !== '') {
    parts.push(params.query.trim());
  }
  if (params.from !== undefined && params.from.trim() !== '') {
    parts.push(`from:"${params.from.trim()}"`);
  }
  if (params.since !== undefined) {
    parts.push(`received:>=${readDate(params.since, 'since')}`);
  }
  if (params.until !== undefined) {
    parts.push(`received:<=${readDate(params.until, 'until')}`);
  }
  if (params.unread === true) {
    parts.push('unread:true');
  }
  if (params.hasAttachments === true) {
    parts.push('hasattachments:true');
  }
  return parts.join(' ');
}

function readDate(value: string, name: string): string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value.trim())) {
    throw new Error(`Аргумент ${name} должен быть датой в формате ГГГГ-ММ-ДД`);
  }
  return value.trim().slice(0, 10);
}

export function buildFindSoap(
  params: MailSearch,
  folder: MailFolder,
  limit: number,
  order: 'Ascending' | 'Descending'
): string {
  const query = buildAqs(params);
  const restriction = query === '' ? '' : `\n      <m:QueryString>${escapeXml(query)}</m:QueryString>`;
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types">
  <soap:Header>
    <t:RequestServerVersion Version="Exchange2013" />
  </soap:Header>
  <soap:Body>
    <m:FindItem Traversal="Shallow">
      <m:ItemShape>
        <t:BaseShape>IdOnly</t:BaseShape>
        <t:BodyType>Text</t:BodyType>
        <t:AdditionalProperties>
          <t:FieldURI FieldURI="item:Subject" />
          <t:FieldURI FieldURI="message:From" />
          <t:FieldURI FieldURI="item:DateTimeReceived" />
          <t:FieldURI FieldURI="item:Body" />
          <t:FieldURI FieldURI="message:IsRead" />
          <t:FieldURI FieldURI="item:HasAttachments" />
        </t:AdditionalProperties>
      </m:ItemShape>
      <m:IndexedPageItemView MaxEntriesReturned="${limit}" Offset="0" BasePoint="Beginning" />${restriction}
      <m:SortOrder>
        <t:FieldOrder Order="${order}">
          <t:FieldURI FieldURI="item:DateTimeReceived" />
        </t:FieldOrder>
      </m:SortOrder>
      <m:ParentFolderIds>
        <t:DistinguishedFolderId Id="${FOLDERS[folder]}" />
      </m:ParentFolderIds>
    </m:FindItem>
  </soap:Body>
</soap:Envelope>`;
}

export function buildGetSoap(id: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types">
  <soap:Header>
    <t:RequestServerVersion Version="Exchange2013" />
  </soap:Header>
  <soap:Body>
    <m:GetItem>
      <m:ItemShape>
        <t:BaseShape>IdOnly</t:BaseShape>
        <t:BodyType>Text</t:BodyType>
        <t:AdditionalProperties>
          <t:FieldURI FieldURI="item:Subject" />
          <t:FieldURI FieldURI="message:From" />
          <t:FieldURI FieldURI="message:ToRecipients" />
          <t:FieldURI FieldURI="item:DateTimeReceived" />
          <t:FieldURI FieldURI="item:Body" />
          <t:FieldURI FieldURI="item:HasAttachments" />
          <t:FieldURI FieldURI="item:Attachments" />
          <t:FieldURI FieldURI="item:ConversationId" />
        </t:AdditionalProperties>
      </m:ItemShape>
      <m:ItemIds>
        <t:ItemId Id="${escapeXml(id)}" />
      </m:ItemIds>
    </m:GetItem>
  </soap:Body>
</soap:Envelope>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
