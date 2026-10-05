import { asArray, asBool, asText, toIso, type RawResponseMessage } from './ews';
import { mailPreview } from './mail-format';
import type { MailAttachment, MailSummary } from './mail-types';

export function toSummary(item: RawMessageItem): MailSummary {
  return {
    id: asText(item.ItemId?.['@_Id']),
    subject: asText(item.Subject),
    from: mailboxName(item.From?.Mailbox),
    date: toIso(item.DateTimeReceived),
    preview: mailPreview(item.Body),
    unread: isFalse(item.IsRead),
    hasAttachments: asBool(item.HasAttachments)
  };
}

export function readItem(message: RawResponseMessage): RawMessageItem {
  const fromItems = message.Items?.Message as RawMessageItem | RawMessageItem[] | undefined;
  const fromFolder = message.RootFolder?.Items?.Message as RawMessageItem | RawMessageItem[] | undefined;
  return asArray(fromItems ?? fromFolder)[0] ?? {};
}

export function readAttachments(item: RawMessageItem): MailAttachment[] {
  const attachments = item.Attachments ?? {};
  const files = [...asArray(attachments.FileAttachment), ...asArray(attachments.ItemAttachment)];
  return files.map((file) => {
    const size = Number(file.Size);
    return { name: asText(file.Name), size: Number.isFinite(size) ? size : 0 };
  });
}

export function mailboxName(mailbox: RawMailbox | undefined): string {
  if (mailbox === undefined) {
    return '';
  }
  return asText(mailbox.Name) || asText(mailbox.EmailAddress);
}

export function conversationIdOf(value: unknown): string {
  if (value !== null && typeof value === 'object' && '@_Id' in value) {
    return asText((value as { '@_Id'?: unknown })['@_Id']);
  }
  return asText(value);
}

function isFalse(value: unknown): boolean {
  return value === false || value === 'false';
}

interface RawMailbox {
  Name?: unknown;
  EmailAddress?: unknown;
}

export interface RawMessageItem {
  ItemId?: { '@_Id'?: unknown };
  Subject?: unknown;
  From?: { Mailbox?: RawMailbox };
  ToRecipients?: { Mailbox?: RawMailbox | RawMailbox[] };
  DateTimeReceived?: unknown;
  Body?: unknown;
  IsRead?: unknown;
  HasAttachments?: unknown;
  ConversationId?: unknown;
  Attachments?: {
    FileAttachment?: RawAttachment | RawAttachment[];
    ItemAttachment?: RawAttachment | RawAttachment[];
  };
}

interface RawAttachment {
  Name?: unknown;
  Size?: unknown;
}
