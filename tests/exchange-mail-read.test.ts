import { describe, expect, it } from 'vitest';
import {
  esc,
  findResponse,
  getResponse,
  mailItem,
  NO_MUTATION,
  setup
} from './exchange-mail-helpers';

describe('mail_read', () => {
  it('приводит HTML к тексту, читает получателей и вложения, письмо не помечается прочитанным', async () => {
    const item =
      '<t:Message>' +
      '<t:ItemId Id="M2" />' +
      '<t:Subject>План</t:Subject>' +
      '<t:From><t:Mailbox><t:Name>Олег</t:Name></t:Mailbox></t:From>' +
      '<t:ToRecipients><t:Mailbox><t:Name>Иван</t:Name></t:Mailbox>' +
      '<t:Mailbox><t:Name>Аня</t:Name></t:Mailbox></t:ToRecipients>' +
      '<t:DateTimeReceived>2026-10-06T09:00:00Z</t:DateTimeReceived>' +
      `<t:Body>&lt;p&gt;Первая строка&lt;/p&gt;&lt;p&gt;${esc('> цитата прошлого письма')}&lt;/p&gt;</t:Body>` +
      '<t:Attachments><t:FileAttachment><t:Name>отчёт.pdf</t:Name><t:Size>2048</t:Size></t:FileAttachment></t:Attachments>' +
      '<t:ConversationId Id="C1" />' +
      '</t:Message>';
    const { mail, calls } = setup([getResponse(item)]);

    const detail = await mail.readMail('M2');

    expect(detail.subject).toBe('План');
    expect(detail.from).toBe('Олег');
    expect(detail.to).toEqual(['Иван', 'Аня']);
    expect(detail.text).toContain('Первая строка');
    expect(detail.text).toContain('…');
    expect(detail.text).not.toContain('цитата прошлого');
    expect(detail.attachments).toEqual([{ name: 'отчёт.pdf', size: 2048 }]);
    expect(calls[0].soapBody).toContain('<m:GetItem>');
    expect(calls[0].soapBody).toContain('Id="M2"');
    for (const operation of NO_MUTATION) {
      expect(calls[0].soapBody).not.toContain(operation);
    }
    expect(calls[0].soapBody).not.toContain('<t:IsRead>true');
  });

  it('длинный текст обрезается до 8000 знаков', async () => {
    const long = 'а'.repeat(9000);
    const { mail } = setup([
      getResponse(mailItem({ id: 'M3', subject: 'Долгое', from: 'Аня', body: long }))
    ]);

    const detail = await mail.readMail('M3');

    expect(detail.text).toHaveLength(8000);
    expect(detail.truncated).toBe(true);
  });
});

describe('только чтение', () => {
  it('ни один запрос не содержит операций изменения', async () => {
    const { mail, calls } = setup([
      findResponse(mailItem({ id: 'M1', subject: 'Один', from: 'Аня' })),
      getResponse(mailItem({ id: 'M1', subject: 'Один', from: 'Аня', conversationId: 'C1' })),
      getResponse(mailItem({ id: 'M1', subject: 'Один', from: 'Аня', conversationId: 'C1' })),
      findResponse(mailItem({ id: 'M1', subject: 'Один', from: 'Аня' })),
      findResponse(mailItem({ id: 'M1', subject: 'Один', from: 'Аня' }), 1)
    ]);

    await mail.searchMail({ query: 'привет' });
    await mail.readMail('M1');
    await mail.thread('M1');
    await mail.unread();

    expect(calls).toHaveLength(5);
    for (const call of calls) {
      for (const operation of NO_MUTATION) {
        expect(call.soapBody).not.toContain(operation);
      }
    }
  });
});
