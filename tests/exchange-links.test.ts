import { describe, expect, it } from 'vitest';
import { mailDraftLink, meetingDraftLink } from '../mcp-servers/exchange/src/links';

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

describe('meetingDraftLink', () => {
  it('даёт startdt и enddt в местном времени без часового пояса', () => {
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
        '&startdt=2026-10-05T09%3A30%3A00' +
        '&enddt=2026-10-05T10%3A00%3A00' +
        `&location=${encodeURIComponent('Переговорка 3')}` +
        `&body=${encodeURIComponent('Обсудим планы')}`
    );
    expect(url).not.toContain('Z');
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
        '&startdt=2026-10-05T09%3A00%3A00' +
        '&enddt=2026-10-05T10%3A00%3A00'
    );
    expect(url).not.toContain('subject=');
    expect(url).not.toContain('location=');
  });
});
