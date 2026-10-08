import { describe, expect, it } from 'vitest';
import {
  DRAFT_URL_LIMIT,
  fitMailDraftLink,
  mailDraftLink,
  meetingDraftLink
} from '../mcp-servers/exchange/src/links';

describe('mailDraftLink', () => {
  it('кодирует кириллицу, пробелы и адрес, нормализует косую черту', () => {
    const url = mailDraftLink('https://mail.example.org/owa', {
      to: 'ivan@example.org',
      subject: 'Привет, Иван',
      body: 'Как дела?'
    });

    expect(url).toBe(
      'https://mail.example.org/owa/?path=/mail/action/compose' +
        '&to=ivan%40example.org' +
        `&subject=${encodeURIComponent('Привет, Иван')}` +
        `&body=${encodeURIComponent('Как дела?')}`
    );
    expect(url).not.toContain('Привет');
    expect(url).toContain('%20');
  });

  it('пропускает пустые и отсутствующие параметры', () => {
    const url = mailDraftLink('https://mail.example.org/owa/', {
      subject: 'Отчёт',
      to: '   ',
      body: undefined
    });

    expect(url).toBe(
      `https://mail.example.org/owa/?path=/mail/action/compose&subject=${encodeURIComponent('Отчёт')}`
    );
    expect(url).not.toContain('to=');
    expect(url).not.toContain('body=');
  });

  it('без параметров возвращает только путь compose', () => {
    const url = mailDraftLink('https://mail.example.org/owa', {});

    expect(url).toBe('https://mail.example.org/owa/?path=/mail/action/compose');
  });
});

describe('fitMailDraftLink', () => {
  it('короткий текст оставляет ссылку целой', () => {
    const result = fitMailDraftLink('https://mail.example.org/owa', {
      to: 'ivan@example.org',
      subject: 'Привет',
      body: 'Как дела?'
    });

    expect(result.truncated).toBe(false);
    expect(result.body).toBe('Как дела?');
    expect(result.url).toBe(mailDraftLink('https://mail.example.org/owa', {
      to: 'ivan@example.org',
      subject: 'Привет',
      body: 'Как дела?'
    }));
  });

  it('длинный текст сокращается в ссылке, а полный текст возвращается', () => {
    const body = 'текст письма '.repeat(300);
    const result = fitMailDraftLink('https://mail.example.org/owa', {
      to: 'ivan@example.org',
      subject: 'Отчёт',
      body
    });

    expect(result.truncated).toBe(true);
    expect(result.body).toBe(body);
    expect(result.url.length).toBeLessThanOrEqual(DRAFT_URL_LIMIT);
    expect(result.url.startsWith('https://mail.example.org/owa/?path=/mail/action/compose')).toBe(true);
    expect(result.url).toContain('to=ivan%40example.org');
  });
});

describe('meetingDraftLink', () => {
  function owaStamp(year: number, month: number, day: number, hour: number, minute: number): string {
    const pad = (part: number): string => String(part).padStart(2, '0');
    return encodeURIComponent(`${year}-${pad(month + 1)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00`);
  }

  it('даёт startdt и enddt в местном времени, как 7 октября', () => {
    const start = new Date(2026, 9, 5, 9, 30, 0).toISOString();
    const end = new Date(2026, 9, 5, 10, 0, 0).toISOString();

    const url = meetingDraftLink('https://mail.example.org/owa', {
      subject: 'Планёрка',
      start,
      end,
      location: 'Переговорка 3',
      body: 'Обсудим планы'
    });

    expect(url).toBe(
      'https://mail.example.org/owa/?path=/calendar/action/compose' +
        `&subject=${encodeURIComponent('Планёрка')}` +
        `&startdt=${owaStamp(2026, 9, 5, 9, 30)}` +
        `&enddt=${owaStamp(2026, 9, 5, 10, 0)}` +
        `&location=${encodeURIComponent('Переговорка 3')}` +
        `&body=${encodeURIComponent('Обсудим планы')}`
    );
    expect(url).not.toContain('Z');
    expect(url).not.toContain('view/Month');
  });

  it('пропускает пустые параметры встречи', () => {
    const start = new Date(2026, 9, 5, 9, 0, 0).toISOString();
    const end = new Date(2026, 9, 5, 10, 0, 0).toISOString();

    const url = meetingDraftLink('https://mail.example.org/owa/', {
      subject: '',
      start,
      end,
      location: '   '
    });

    expect(url).toBe(
      'https://mail.example.org/owa/?path=/calendar/action/compose' +
        `&startdt=${owaStamp(2026, 9, 5, 9, 0)}` +
        `&enddt=${owaStamp(2026, 9, 5, 10, 0)}`
    );
    expect(url).not.toContain('subject=');
    expect(url).not.toContain('location=');
  });

  it('кладёт адреса в to, из текста с именами вытаскивает почту', () => {
    const start = new Date(2026, 9, 5, 17, 0, 0).toISOString();
    const end = new Date(2026, 9, 5, 18, 0, 0).toISOString();
    const url = meetingDraftLink('https://mail.example.org/owa', {
      subject: 'Встреча',
      start,
      end,
      to: 'Иван — ivan@example.org, Мария maria@example.org'
    });
    expect(url).toContain('?path=/calendar/action/compose');
    expect(url).toContain('to=ivan%40example.org%3Bmaria%40example.org');
    expect(url).not.toContain('view/Month');
    expect(url).not.toContain('ae=Item');
  });

  it('понимает «вторник 17:00» и ставит час, если конец совпадает с началом', () => {
    const now = new Date(2026, 9, 3, 12, 0, 0);
    const url = meetingDraftLink(
      'https://mail.example.org/owa',
      {
        subject: 'Встреча',
        start: 'вторник 17:00',
        end: 'вторник 17:00',
        to: 'ivan@example.org'
      },
      now
    );
    expect(url).toContain(`startdt=${owaStamp(2026, 9, 6, 17, 0)}`);
    expect(url).toContain(`enddt=${owaStamp(2026, 9, 6, 18, 0)}`);
    expect(url).toContain('to=ivan%40example.org');
  });
});
