import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import type { ExchangeMail, MailDetail, MailSummary } from '../mcp-servers/exchange/src/mail';
import { createExchangeServer } from '../mcp-servers/exchange/src/server';

const OWA = 'https://mail.example.org/owa';

function summary(patch: Partial<MailSummary> = {}): MailSummary {
  return {
    id: 'M1',
    subject: 'Отчёт',
    from: 'Аня',
    date: '2026-10-06T08:00:00.000Z',
    preview: 'Первые слова',
    unread: true,
    hasAttachments: false,
    ...patch
  };
}

function detail(patch: Partial<MailDetail> = {}): MailDetail {
  return {
    id: 'M1',
    subject: 'Отчёт',
    from: 'Аня',
    to: ['Иван'],
    date: '2026-10-06T08:00:00.000Z',
    text: 'текст',
    truncated: false,
    attachments: [{ name: 'отчёт.pdf', size: 12 }],
    conversationId: 'C1',
    ...patch
  };
}

function stubMail(): ExchangeMail {
  return {
    searchMail: async () => [summary()],
    readMail: async () => detail(),
    unread: async () => ({ unread: 3, latest: [summary()] }),
    thread: async () => [
      { id: 'M0', subject: 'Отчёт', from: 'Аня', date: '2026-10-05T08:00:00.000Z', preview: 'старое' },
      { id: 'M1', subject: 'Отчёт', from: 'Олег', date: '2026-10-06T08:00:00.000Z', preview: 'новое' }
    ]
  };
}

async function connect(server: McpServer): Promise<{ client: Client; close: () => Promise<void> }> {
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

async function call(session: Awaited<ReturnType<typeof connect>>, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  return (await session.client.callTool({ name, arguments: args })) as CallToolResult;
}

function dataOf(result: CallToolResult): Record<string, unknown> {
  return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
}

describe('инструменты почты', () => {
  it('mail_search возвращает письма со ссылкой в веб-почте', async () => {
    const session = await connect(createExchangeServer({ mail: stubMail(), owaUrl: OWA }));
    try {
      const result = await call(session, 'mail_search', { query: 'отчёт' });
      const data = dataOf(result) as { mails: { url: string }[] };
      expect(data.mails[0].url).toBe(`${OWA}/?path=/mail/inbox&ItemID=M1`);
    } finally {
      await session.close();
    }
  });

  it('mail_read помечает обрезанный текст и не читает вложения', async () => {
    const mail = stubMail();
    mail.readMail = async () => detail({ truncated: true });
    const session = await connect(createExchangeServer({ mail, owaUrl: OWA }));
    try {
      const result = await call(session, 'mail_read', { id: 'M1' });
      const data = dataOf(result);
      expect(data.note).toContain('не полностью');
      expect(data.attachments).toEqual([{ name: 'отчёт.pdf', size: 12 }]);
      expect(JSON.stringify(data)).not.toContain('содержимое');
    } finally {
      await session.close();
    }
  });

  it('mail_unread отдаёт число и последние письма', async () => {
    const session = await connect(createExchangeServer({ mail: stubMail(), owaUrl: OWA }));
    try {
      const data = dataOf(await call(session, 'mail_unread', {})) as { unread: number; mails: unknown[] };
      expect(data.unread).toBe(3);
      expect(data.mails).toHaveLength(1);
    } finally {
      await session.close();
    }
  });

  it('mail_thread отдаёт переписку со ссылками', async () => {
    const session = await connect(createExchangeServer({ mail: stubMail(), owaUrl: OWA }));
    try {
      const data = dataOf(await call(session, 'mail_thread', { id: 'M1' })) as {
        mails: { id: string; url: string }[];
      };
      expect(data.mails.map((item) => item.id)).toEqual(['M0', 'M1']);
      expect(data.mails[0].url).toBe(`${OWA}/?path=/mail/inbox&ItemID=M0`);
    } finally {
      await session.close();
    }
  });

  it('без учётных данных инструменты почты дают понятную ошибку', async () => {
    const session = await connect(createExchangeServer({ owaUrl: OWA }));
    try {
      const result = await call(session, 'mail_search', {});
      expect(result.isError).toBe(true);
      expect((result.content[0] as { text: string }).text).toContain('EXCHANGE_EWS_URL');
    } finally {
      await session.close();
    }
  });

  it('mail_search без id требует идентификатор в mail_read', async () => {
    const session = await connect(createExchangeServer({ mail: stubMail(), owaUrl: OWA }));
    try {
      const result = await call(session, 'mail_read', {});
      expect(result.isError).toBe(true);
    } finally {
      await session.close();
    }
  });
});
