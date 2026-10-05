export type MailFolder = 'inbox' | 'sent' | 'drafts' | 'all';

export interface MailSearch {
  query?: string;
  from?: string;
  folder?: MailFolder;
  since?: string;
  until?: string;
  unread?: boolean;
  hasAttachments?: boolean;
  limit?: number;
}

export interface MailSummary {
  id: string;
  subject: string;
  from: string;
  date: string;
  preview: string;
  unread: boolean;
  hasAttachments: boolean;
}

export interface MailAttachment {
  name: string;
  size: number;
}

export interface MailDetail {
  id: string;
  subject: string;
  from: string;
  to: string[];
  date: string;
  text: string;
  truncated: boolean;
  attachments: MailAttachment[];
  conversationId: string;
}

export interface UnreadResult {
  unread: number;
  latest: MailSummary[];
}

export interface MailThreadItem {
  id: string;
  subject: string;
  from: string;
  date: string;
  preview: string;
}

export interface ExchangeMail {
  searchMail(params: MailSearch): Promise<MailSummary[]>;
  readMail(id: string): Promise<MailDetail>;
  unread(): Promise<UnreadResult>;
  thread(id: string): Promise<MailThreadItem[]>;
}

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 25;
export const THREAD_LIMIT = 15;
export const UNREAD_LIMIT = 5;
