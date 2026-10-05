import { mailItemLink } from './links';
import type { ExchangeMail, MailDetail, MailSearch, MailSummary, MailThreadItem } from './mail';

export interface MailDeps {
  mail?: ExchangeMail;
  owaUrl?: string;
}

type ToolRun = (args: Record<string, unknown>) => Promise<unknown>;

export function mailRuns(deps: MailDeps): Record<string, ToolRun> {
  return {
    mail_search: async (args) => {
      const mail = requireMail(deps);
      const items = await mail.searchMail(readSearch(args));
      return { mails: items.map((item) => summary(item, deps.owaUrl)) };
    },
    mail_read: async (args) => {
      const mail = requireMail(deps);
      return detail(await mail.readMail(requiredString(args, 'id')), deps.owaUrl);
    },
    mail_unread: async () => {
      const mail = requireMail(deps);
      const result = await mail.unread();
      return {
        unread: result.unread,
        mails: result.latest.map((item) => summary(item, deps.owaUrl))
      };
    },
    mail_thread: async (args) => {
      const mail = requireMail(deps);
      const items = await mail.thread(requiredString(args, 'id'));
      return { mails: items.map((item) => threadItem(item, deps.owaUrl)) };
    }
  };
}

function summary(item: MailSummary, owaUrl: string | undefined): Record<string, unknown> {
  return {
    id: item.id,
    subject: item.subject,
    from: item.from,
    date: item.date,
    preview: item.preview,
    unread: item.unread,
    hasAttachments: item.hasAttachments,
    url: itemUrl(owaUrl, item.id)
  };
}

function threadItem(item: MailThreadItem, owaUrl: string | undefined): Record<string, unknown> {
  return {
    id: item.id,
    subject: item.subject,
    from: item.from,
    date: item.date,
    preview: item.preview,
    url: itemUrl(owaUrl, item.id)
  };
}

function detail(item: MailDetail, owaUrl: string | undefined): Record<string, unknown> {
  const result: Record<string, unknown> = {
    id: item.id,
    subject: item.subject,
    from: item.from,
    to: item.to,
    date: item.date,
    text: item.text,
    attachments: item.attachments,
    url: itemUrl(owaUrl, item.id)
  };
  if (item.truncated) {
    result.note = 'Текст письма показан не полностью';
  }
  return result;
}

function itemUrl(owaUrl: string | undefined, id: string): string {
  return owaUrl === undefined || id === '' ? '' : mailItemLink(owaUrl, id);
}

function readSearch(args: Record<string, unknown>): MailSearch {
  const search: MailSearch = {};
  const query = optionalString(args, 'query');
  const from = optionalString(args, 'from');
  const folder = optionalFolder(args);
  const since = optionalString(args, 'since');
  const until = optionalString(args, 'until');
  if (query !== undefined) search.query = query;
  if (from !== undefined) search.from = from;
  if (folder !== undefined) search.folder = folder;
  if (since !== undefined) search.since = since;
  if (until !== undefined) search.until = until;
  if (args.unread === true) search.unread = true;
  if (args.has_attachments === true) search.hasAttachments = true;
  const limit = args.limit;
  if (typeof limit === 'number' && Number.isFinite(limit)) search.limit = limit;
  return search;
}

function optionalFolder(args: Record<string, unknown>): MailSearch['folder'] {
  const value = args.folder;
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value === 'inbox' || value === 'sent' || value === 'drafts' || value === 'all') {
    return value;
  }
  throw new Error('Аргумент folder должен быть inbox, sent, drafts или all');
}

function requireMail(deps: MailDeps): ExchangeMail {
  if (deps.mail === undefined) {
    throw new Error(
      'Почта недоступна: не заданы EXCHANGE_EWS_URL, EXCHANGE_USER или EXCHANGE_PASSWORD'
    );
  }
  return deps.mail;
}

function optionalString(args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new Error(`Аргумент ${name} должен быть строкой`);
  }
  return value;
}

function requiredString(args: Record<string, unknown>, name: string): string {
  const value = optionalString(args, name);
  if (value === undefined || value.trim() === '') {
    throw new Error(`Аргумент ${name} обязателен`);
  }
  return value;
}
