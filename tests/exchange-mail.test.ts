import { describe, expect, it } from 'vitest';
import { createMailClient, type MailSearch } from '../mcp-servers/exchange/src/mail';
import type { EwsPost } from '../mcp-servers/exchange/src/ews';
import {
  catchError,
  findResponse,
  getResponse,
  mailItem,
  PASSWORD,
  setup,
  type CapturedPost
} from './exchange-mail-helpers';

describe('mail_search', () => {
  it('ищет по словам, отдаёт первые 200 знаков и сортирует от новых к старым', async () => {
    const { mail, calls } = setup([
      findResponse(
        mailItem({
          id: 'M1',
          subject: 'Отчёт',
          from: 'Аня',
          date: '2026-10-06T08:00:00Z',
          body: `<html><body><p>Привет</p><p>${'слово '.repeat(60)}</p></body></html>`,
          unread: true,
          attachments: true
        })
      )
    ]);

    const items = await mail.searchMail({ query: 'отчёт', limit: 30 });

    expect(calls[0].soapBody).toContain('QueryString');
    expect(calls[0].soapBody).toContain('отчёт');
    expect(calls[0].soapBody).toContain('Order="Descending"');
    expect(calls[0].soapBody).toContain('MaxEntriesReturned="25"');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'M1',
      subject: 'Отчёт',
      from: 'Аня',
      unread: true,
      hasAttachments: true
    });
    expect(items[0].preview.length).toBeLessThanOrEqual(200);
    expect(items[0].preview).not.toContain('<');
  });

  it('строит условия по отправителю, периоду, непрочитанным и вложениям', async () => {
    const { mail, calls } = setup([findResponse('')]);

    await mail.searchMail({
      from: 'ivan@example.org',
      since: '2026-10-01',
      until: '2026-10-07',
      unread: true,
      hasAttachments: true
    } as MailSearch);

    const body = calls[0].soapBody;
    expect(body).toContain('from:&quot;ivan@example.org&quot;');
    expect(body).toContain('received:&gt;=2026-10-01');
    expect(body).toContain('received:&lt;=2026-10-07');
    expect(body).toContain('unread:true');
    expect(body).toContain('hasattachments:true');
  });

  it('пустой результат даёт пустой список', async () => {
    const { mail } = setup([findResponse('')]);
    await expect(mail.searchMail({})).resolves.toEqual([]);
  });

  it('ошибка авторизации 401 даёт понятное сообщение', async () => {
    const calls: CapturedPost[] = [];
    const post: EwsPost = async (url, soapBody, auth) => {
      calls.push({ url, soapBody, auth });
      return { status: 401, body: '' };
    };
    const mail = createMailClient({
      ewsUrl: 'https://mail.example.org/EWS/Exchange.asmx',
      user: 'DOMAIN\\ivan',
      password: PASSWORD,
      post
    });

    const error = await catchError(mail.searchMail({}));
    expect(error.message).toBe('Exchange отклонил логин или пароль');
    expect(error.message).not.toContain(PASSWORD);
  });
});

describe('mail_unread и mail_thread', () => {
  it('даёт число непрочитанных и последние письма', async () => {
    const { mail, calls } = setup([
      findResponse(mailItem({ id: 'U1', subject: 'Свежее', from: 'Аня', unread: true }), 7)
    ]);

    const result = await mail.unread();

    expect(result.unread).toBe(7);
    expect(result.latest).toHaveLength(1);
    expect(calls[0].soapBody).toContain('unread:true');
    expect(calls[0].soapBody).toContain('MaxEntriesReturned="5"');
  });

  it('собирает переписку по идентификатору письма от старых к новым', async () => {
    const { mail, calls } = setup([
      getResponse(mailItem({ id: 'T1', subject: 'Тема', from: 'Аня', conversationId: 'C1' })),
      findResponse(
        mailItem({ id: 'T0', subject: 'Тема', from: 'Аня', date: '2026-10-05T08:00:00Z' }) +
          mailItem({ id: 'T1', subject: 'Тема', from: 'Олег', date: '2026-10-06T08:00:00Z' })
      )
    ]);

    const items = await mail.thread('T1');

    expect(items.map((item) => item.id)).toEqual(['T0', 'T1']);
    expect(calls[1].soapBody).toContain('Order="Ascending"');
    expect(calls[1].soapBody).toContain('conversationid');
    expect(calls[1].soapBody).toContain('MaxEntriesReturned="15"');
  });
});
