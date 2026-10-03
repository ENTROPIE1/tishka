import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import {
  createExchangeClient,
  splitUser,
  type EwsPost,
  type ExchangeClient,
  type Meeting
} from '../mcp-servers/exchange/src/client';
import {
  createExchangeServer,
  pickNextMeeting,
  type ExchangeCalendar
} from '../mcp-servers/exchange/src/server';

const EWS_URL = 'https://mail.example.org/EWS/Exchange.asmx';
const USER = 'DOMAIN\\ivan';
const PASSWORD = 'secret-pass-1';
const DAY_MS = 24 * 60 * 60 * 1000;

interface CapturedPost {
  url: string;
  soapBody: string;
  auth: { user: string; password: string };
}

function setup(
  body: string,
  status = 200
): { client: ExchangeClient; calls: CapturedPost[] } {
  const calls: CapturedPost[] = [];
  const post: EwsPost = async (url, soapBody, auth) => {
    calls.push({ url, soapBody, auth });
    return { status, body };
  };
  return { client: createExchangeClient({ ewsUrl: EWS_URL, user: USER, password: PASSWORD, post }), calls };
}

function findItemResponse(items: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types">
  <s:Body>
    <m:FindItemResponse>
      <m:ResponseMessages>
        <m:FindItemResponseMessage ResponseClass="Success">
          <m:ResponseCode>NoError</m:ResponseCode>
          <m:RootFolder IncludesLastItemInRange="true">
            <t:Items>${items}</t:Items>
          </m:RootFolder>
        </m:FindItemResponseMessage>
      </m:ResponseMessages>
    </m:FindItemResponse>
  </s:Body>
</s:Envelope>`;
}

function findItemErrorResponse(code: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages">
  <s:Body>
    <m:FindItemResponse>
      <m:ResponseMessages>
        <m:FindItemResponseMessage ResponseClass="Error">
          <m:ResponseCode>${code}</m:ResponseCode>
        </m:FindItemResponseMessage>
      </m:ResponseMessages>
    </m:FindItemResponse>
  </s:Body>
</s:Envelope>`;
}

function calendarItem(params: {
  subject: string;
  start: string;
  end: string;
  location: string;
  organizer: string;
}): string {
  return (
    '<t:CalendarItem>' +
    `<t:Subject>${params.subject}</t:Subject>` +
    `<t:Start>${params.start}</t:Start>` +
    `<t:End>${params.end}</t:End>` +
    `<t:Location>${params.location}</t:Location>` +
    '<t:Organizer><t:Mailbox>' +
    `<t:Name>${params.organizer}</t:Name>` +
    '<t:EmailAddress>organizer@example.org</t:EmailAddress>' +
    '</t:Mailbox></t:Organizer>' +
    '</t:CalendarItem>'
  );
}

async function catchError(promise: Promise<unknown>): Promise<Error> {
  const caught = await promise.catch((error: unknown) => error);
  expect(caught).toBeInstanceOf(Error);
  return caught as Error;
}

describe('createExchangeClient', () => {
  const from = new Date('2026-10-05T00:00:00Z');
  const to = new Date('2026-10-06T00:00:00Z');

  it('разбирает три встречи и сортирует их по времени начала', async () => {
    const { client } = setup(
      findItemResponse(
        [
          calendarItem({
            subject: 'Поздняя',
            start: '2026-10-05T14:00:00Z',
            end: '2026-10-05T15:00:00Z',
            location: 'Переговорка 2',
            organizer: 'Олег'
          }),
          calendarItem({
            subject: 'Ранняя',
            start: '2026-10-05T09:00:00Z',
            end: '2026-10-05T10:00:00Z',
            location: 'Zoom https://zoom.example.org/j/12345 записаться',
            organizer: 'Иван'
          }),
          calendarItem({
            subject: 'Средняя',
            start: '2026-10-05T11:00:00Z',
            end: '2026-10-05T12:00:00Z',
            location: 'Переговорка 5',
            organizer: 'Аня'
          })
        ].join('')
      )
    );

    const meetings = await client.listMeetings(from, to);

    expect(meetings.map((meeting) => meeting.subject)).toEqual(['Ранняя', 'Средняя', 'Поздняя']);
    expect(meetings[0]).toEqual({
      subject: 'Ранняя',
      start: '2026-10-05T09:00:00.000Z',
      end: '2026-10-05T10:00:00.000Z',
      location: 'Zoom https://zoom.example.org/j/12345 записаться',
      organizer: 'Иван',
      joinUrl: 'https://zoom.example.org/j/12345'
    });
    expect(meetings[2]).not.toHaveProperty('joinUrl');
  });

  it('одна встреча разбирается без ошибок', async () => {
    const { client } = setup(
      findItemResponse(
        calendarItem({
          subject: 'Одиночная',
          start: '2026-10-05T09:00:00Z',
          end: '2026-10-05T10:00:00Z',
          location: 'Переговорка 1',
          organizer: 'Иван'
        })
      )
    );

    const meetings = await client.listMeetings(from, to);

    expect(meetings).toHaveLength(1);
    expect(meetings[0].subject).toBe('Одиночная');
    expect(meetings[0].start).toBe('2026-10-05T09:00:00.000Z');
  });

  it('ответ без встреч разбирается как пустой список', async () => {
    const { client } = setup(findItemResponse(''));

    await expect(client.listMeetings(from, to)).resolves.toEqual([]);
  });

  it('RootFolder без Items разбирается как пустой список', async () => {
    const { client } = setup(
      `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages">
  <s:Body>
    <m:FindItemResponse>
      <m:ResponseMessages>
        <m:FindItemResponseMessage ResponseClass="Success">
          <m:ResponseCode>NoError</m:ResponseCode>
          <m:RootFolder IncludesLastItemInRange="true" />
        </m:FindItemResponseMessage>
      </m:ResponseMessages>
    </m:FindItemResponse>
  </s:Body>
</s:Envelope>`
    );

    await expect(client.listMeetings(from, to)).resolves.toEqual([]);
  });

  it('границы CalendarView уходят в UTC и соответствуют переданным датам', async () => {
    const { client, calls } = setup(findItemResponse(''));
    const localFrom = new Date(2026, 9, 5, 9, 0, 0);
    const localTo = new Date(2026, 9, 6, 9, 0, 0);

    await client.listMeetings(localFrom, localTo);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(EWS_URL);
    expect(calls[0].auth).toEqual({ user: USER, password: PASSWORD });
    expect(calls[0].soapBody).toContain(`StartDate="${localFrom.toISOString()}"`);
    expect(calls[0].soapBody).toContain(`EndDate="${localTo.toISOString()}"`);
    expect(calls[0].soapBody).toContain('Version="Exchange2013"');
    expect(calls[0].soapBody).toContain('<t:DistinguishedFolderId Id="calendar" />');
    expect(calls[0].soapBody).toContain('FieldURI="item:Subject"');
    expect(calls[0].soapBody).toContain('FieldURI="calendar:Start"');
    expect(calls[0].soapBody).toContain('FieldURI="calendar:End"');
    expect(calls[0].soapBody).toContain('FieldURI="calendar:Location"');
    expect(calls[0].soapBody).toContain('FieldURI="calendar:Organizer"');
  });

  it('401 превращается в ошибку про логин и пароль, пароль не утекает', async () => {
    const { client } = setup('', 401);

    const error = await catchError(client.listMeetings(from, to));

    expect(error.message).toBe('Exchange отклонил логин или пароль');
    expect(error.message).not.toContain(PASSWORD);
  });

  it('ошибочный ResponseCode даёт текст с этим кодом, пароль не утекает', async () => {
    const { client } = setup(findItemErrorResponse('ErrorAccessDenied'));

    const error = await catchError(client.listMeetings(from, to));

    expect(error.message).toBe('Exchange вернул код ошибки: ErrorAccessDenied');
    expect(error.message).not.toContain(PASSWORD);
  });

  it('сбой сети превращается в ошибку про VPN, пароль не утекает', async () => {
    const post: EwsPost = async () => {
      throw new Error(`connect ECONNREFUSED ${PASSWORD}`);
    };
    const client = createExchangeClient({ ewsUrl: EWS_URL, user: USER, password: PASSWORD, post });

    const error = await catchError(client.listMeetings(from, to));

    expect(error.message).toBe('Почтовый сервер недоступен, проверьте VPN');
    expect(error.message).not.toContain(PASSWORD);
  });

  it('splitUser выделяет домен из DOMAIN\\user', () => {
    expect(splitUser('DOMAIN\\ivan')).toEqual({ domain: 'DOMAIN', username: 'ivan' });
    expect(splitUser('ivan@example.org')).toEqual({ domain: '', username: 'ivan@example.org' });
  });
});

type Session = { client: Client; close: () => Promise<void> };

function meeting(subject: string, start: Date, end: Date): Meeting {
  return {
    subject,
    start: start.toISOString(),
    end: end.toISOString(),
    location: 'Переговорка',
    organizer: 'Иван'
  };
}

function emptyCalendar(): ExchangeCalendar {
  return { listMeetings: async () => [] };
}

async function connect(server: McpServer): Promise<Session> {
  const client = new Client({ name: 'test', version: '0.0.0' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    }
  };
}

async function callTool(
  session: Session,
  name: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  return (await session.client.callTool({ name, arguments: args })) as CallToolResult;
}

function textOf(result: CallToolResult): string {
  return (result.content[0] as { type: string; text: string }).text;
}

describe('createExchangeServer', () => {
  it('объявляет четыре инструмента с readOnlyHint', async () => {
    const session = await connect(createExchangeServer({ calendar: emptyCalendar() }));
    try {
      const { tools } = await session.client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        'list_meetings',
        'mail_draft_link',
        'meeting_draft_link',
        'next_meeting'
      ]);
      for (const tool of tools) {
        expect(tool.annotations?.readOnlyHint).toBe(true);
      }
    } finally {
      await session.close();
    }
  });

  it('list_meetings считает границы от локальной полуночи переданного дня', async () => {
    const windows: { from: Date; to: Date }[] = [];
    const calendar: ExchangeCalendar = {
      listMeetings: async (from, to) => {
        windows.push({ from, to });
        return [meeting('Встреча', new Date('2026-10-05T09:00:00Z'), new Date('2026-10-05T10:00:00Z'))];
      }
    };
    const session = await connect(createExchangeServer({ calendar }));
    try {
      const result = await callTool(session, 'list_meetings', { date: '2026-10-05', days: 2 });
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(textOf(result)) as { meetings: Meeting[] };
      expect(data.meetings).toHaveLength(1);
      expect(windows[0].from.getTime()).toBe(new Date(2026, 9, 5).getTime());
      expect(windows[0].to.getTime() - windows[0].from.getTime()).toBe(2 * DAY_MS);
    } finally {
      await session.close();
    }
  });

  it('list_meetings обрезает days до четырнадцати', async () => {
    const windows: { from: Date; to: Date }[] = [];
    const calendar: ExchangeCalendar = {
      listMeetings: async (from, to) => {
        windows.push({ from, to });
        return [];
      }
    };
    const session = await connect(createExchangeServer({ calendar }));
    try {
      const result = await callTool(session, 'list_meetings', { days: 30 });
      expect(result.isError).toBeUndefined();
      expect(JSON.parse(textOf(result))).toEqual({ meetings: [] });
      expect(windows[0].to.getTime() - windows[0].from.getTime()).toBe(14 * DAY_MS);
    } finally {
      await session.close();
    }
  });

  it('next_meeting выбирает ближайшую незакончившуюся встречу', async () => {
    const now = Date.now();
    const windows: { from: Date; to: Date }[] = [];
    const calendar: ExchangeCalendar = {
      listMeetings: async (from, to) => {
        windows.push({ from, to });
        return [
          meeting('Прошедшая', new Date(now - 2 * 3600_000), new Date(now - 3600_000)),
          meeting('Текущая', new Date(now - 30 * 60_000), new Date(now + 30 * 60_000)),
          meeting('Будущая', new Date(now + 3600_000), new Date(now + 2 * 3600_000))
        ];
      }
    };
    const session = await connect(createExchangeServer({ calendar }));
    try {
      const result = await callTool(session, 'next_meeting', {});
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(textOf(result)) as { meetings: Meeting[] };
      expect(data.meetings).toHaveLength(1);
      expect(data.meetings[0].subject).toBe('Текущая');
      expect(windows[0].to.getTime() - windows[0].from.getTime()).toBe(DAY_MS);
    } finally {
      await session.close();
    }
  });

  it('pickNextMeeting пропускает встречи, которые уже закончились', async () => {
    const now = new Date('2026-10-05T12:00:00Z');

    const picked = await pickNextMeeting(
      async () => [
        meeting('Закончилась', new Date('2026-10-05T11:00:00Z'), new Date('2026-10-05T12:00:00Z')),
        meeting('Позже', new Date('2026-10-05T13:00:00Z'), new Date('2026-10-05T14:00:00Z'))
      ],
      now
    );

    expect(picked?.subject).toBe('Позже');
  });

  it('next_meeting без встреч возвращает сообщение', async () => {
    const session = await connect(createExchangeServer({ calendar: emptyCalendar() }));
    try {
      const result = await callTool(session, 'next_meeting', {});
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(textOf(result)) as { meetings: unknown[]; message: string };
      expect(data.meetings).toEqual([]);
      expect(data.message).toContain('нет');
    } finally {
      await session.close();
    }
  });

  it('mail_draft_link возвращает ссылку на черновик письма', async () => {
    const session = await connect(
      createExchangeServer({ calendar: emptyCalendar(), owaUrl: 'https://mail.example.org/owa' })
    );
    try {
      const result = await callTool(session, 'mail_draft_link', { to: 'anya@example.org', subject: 'Отчёт' });
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(textOf(result)) as { url: string };
      expect(data.url).toBe(
        `https://mail.example.org/owa/?path=/mail/action/compose&to=${encodeURIComponent('anya@example.org')}&subject=${encodeURIComponent('Отчёт')}`
      );
    } finally {
      await session.close();
    }
  });

  it('meeting_draft_link возвращает ссылку на черновик встречи', async () => {
    const session = await connect(
      createExchangeServer({ calendar: emptyCalendar(), owaUrl: 'https://mail.example.org/owa' })
    );
    try {
      const result = await callTool(session, 'meeting_draft_link', {
        subject: 'Встреча',
        start: '2026-10-05T09:00:00Z',
        end: '2026-10-05T10:00:00Z'
      });
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(textOf(result)) as { url: string };
      expect(data.url).toContain('?path=/calendar/action/compose');
      expect(data.url).toContain('startdt=');
      expect(data.url).toContain('enddt=');
    } finally {
      await session.close();
    }
  });

  it('без переменных окружения календарные инструменты дают понятную ошибку', async () => {
    const session = await connect(createExchangeServer({ owaUrl: 'https://mail.example.org/owa' }));
    try {
      const result = await callTool(session, 'list_meetings', {});
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('EXCHANGE_EWS_URL');
    } finally {
      await session.close();
    }
  });

  it('без EXCHANGE_OWA_URL ссылки дают понятную ошибку', async () => {
    const session = await connect(createExchangeServer({ calendar: emptyCalendar() }));
    try {
      const result = await callTool(session, 'mail_draft_link', { to: 'anya@example.org' });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('EXCHANGE_OWA_URL');
    } finally {
      await session.close();
    }
  });
});
