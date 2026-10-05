import {
  asArray,
  asText,
  createEwsTransport,
  toIso,
  type EwsPost,
  type EwsTransport,
  type RawResponseMessage
} from './ews';
import { mailBody, mailPreview } from './mail-format';
import {
  conversationIdOf,
  mailboxName,
  readAttachments,
  readItem,
  toSummary,
  type RawMessageItem
} from './mail-parse';
import { buildFindSoap, buildGetSoap } from './mail-soap';
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  THREAD_LIMIT,
  UNREAD_LIMIT,
  type ExchangeMail,
  type MailDetail,
  type MailFolder,
  type MailSearch,
  type MailSummary,
  type MailThreadItem,
  type UnreadResult
} from './mail-types';

export * from './mail-types';
export { PREVIEW_LIMIT, BODY_LIMIT } from './mail-format';

export function createMailClient(opts: {
  ewsUrl: string;
  user: string;
  password: string;
  post?: EwsPost;
}): ExchangeMail {
  const ews = createEwsTransport(opts);

  const readMail = async (id: string): Promise<MailDetail> => {
    const item = readItem(await getItem(ews, id));
    const body = mailBody(item.Body);
    return {
      id: asText(item.ItemId?.['@_Id']) || id,
      subject: asText(item.Subject),
      from: mailboxName(item.From?.Mailbox),
      to: asArray(item.ToRecipients?.Mailbox).map(mailboxName),
      date: toIso(item.DateTimeReceived),
      text: body.text,
      truncated: body.truncated,
      attachments: readAttachments(item),
      conversationId: conversationIdOf(item.ConversationId)
    };
  };

  return {
    async searchMail(params: MailSearch): Promise<MailSummary[]> {
      const { items } = await find(ews, params, params.folder ?? 'inbox', limitOf(params), 'Descending');
      return items.map(toSummary);
    },
    readMail,
    async unread(): Promise<UnreadResult> {
      const result = await find(ews, { unread: true }, 'inbox', UNREAD_LIMIT, 'Descending');
      return { unread: result.total, latest: result.items.map(toSummary) };
    },
    async thread(id: string): Promise<MailThreadItem[]> {
      const detail = await readMail(id);
      const aqs =
        detail.conversationId !== ''
          ? `conversationid:"${detail.conversationId}"`
          : `subject:"${detail.subject}"`;
      const { items } = await find(ews, { query: aqs }, 'all', THREAD_LIMIT, 'Ascending');
      return items.map((item) => ({
        id: asText(item.ItemId?.['@_Id']),
        subject: asText(item.Subject),
        from: mailboxName(item.From?.Mailbox),
        date: toIso(item.DateTimeReceived),
        preview: mailPreview(item.Body)
      }));
    }
  };
}

function limitOf(params: MailSearch): number {
  const value = params.limit;
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.max(1, Math.trunc(value)), MAX_LIMIT);
}

async function find(
  ews: EwsTransport,
  params: MailSearch,
  folder: MailFolder,
  limit: number,
  order: 'Ascending' | 'Descending'
): Promise<{ items: RawMessageItem[]; total: number }> {
  const message = await ews.call(buildFindSoap(params, folder, limit, order), 'FindItem');
  const items = asArray(
    message.RootFolder?.Items?.Message as RawMessageItem | RawMessageItem[] | undefined
  );
  const total = Number(asText(message.RootFolder?.['@_TotalItemsInView']));
  return { items, total: Number.isFinite(total) ? total : items.length };
}

async function getItem(ews: EwsTransport, id: string): Promise<RawResponseMessage> {
  return ews.call(buildGetSoap(id), 'GetItem');
}
