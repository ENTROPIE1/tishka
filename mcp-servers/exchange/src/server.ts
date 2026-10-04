import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool
} from '@modelcontextprotocol/sdk/types.js';
import type { Meeting } from './client';
import { fitMailDraftLink, LONG_BODY_HINT, meetingDraftLink } from './links';

export interface ExchangeCalendar {
  listMeetings(from: Date, to: Date): Promise<Meeting[]>;
}

export interface ExchangeServerOptions {
  calendar?: ExchangeCalendar;
  owaUrl?: string;
  name?: string;
  version?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAYS = 14;

const TOOLS: Tool[] = [
  {
    name: 'list_meetings',
    description: 'Возвращает встречи из календаря Exchange за день или несколько дней подряд.',
    inputSchema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Дата начала в формате ГГГГ-ММ-ДД, по умолчанию сегодня'
        },
        days: {
          type: 'number',
          minimum: 1,
          maximum: 14,
          description: 'Сколько дней показать, по умолчанию 1, не больше 14'
        }
      }
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'next_meeting',
    description:
      'Возвращает ближайшую встречу Exchange, которая ещё не закончилась, из ближайших 24 часов.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'mail_draft_link',
    description:
      'Возвращает ссылку, которая открывает в веб-почте Outlook черновик письма. ' +
      'Ссылку нужно показать пользователю: черновик открывает и отправляет он сам.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Адрес получателя' },
        subject: { type: 'string', description: 'Тема письма' },
        body: { type: 'string', description: 'Текст письма' }
      }
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'meeting_draft_link',
    description:
      'Возвращает ссылку, которая открывает в веб-почте Outlook черновик встречи. ' +
      'Ссылку нужно показать пользователю: черновик открывает и отправляет он сам.',
    inputSchema: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'Тема встречи' },
        start: { type: 'string', description: 'Начало встречи: дата или дата со временем' },
        end: { type: 'string', description: 'Конец встречи: дата или дата со временем' },
        location: { type: 'string', description: 'Место встречи' },
        body: { type: 'string', description: 'Описание встречи' }
      },
      required: ['start', 'end']
    },
    annotations: { readOnlyHint: true }
  }
];

type ToolRun = (args: Record<string, unknown>) => Promise<unknown>;

export function createExchangeServer(deps: ExchangeServerOptions): Server {
  const server = new Server(
    { name: deps.name ?? 'exchange', version: deps.version ?? '0.0.0' },
    { capabilities: { tools: {} } }
  );
  const runs = toolRuns(deps);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    handleCall(runs, request.params.name, request.params.arguments ?? {})
  );

  return server;
}

export async function pickNextMeeting(
  listMeetings: (from: Date, to: Date) => Promise<Meeting[]>,
  now: Date
): Promise<Meeting | undefined> {
  const meetings = await listMeetings(now, new Date(now.getTime() + DAY_MS));
  return meetings
    .filter((meeting) => new Date(meeting.end).getTime() > now.getTime())
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0];
}

function toolRuns(deps: ExchangeServerOptions): Record<string, ToolRun> {
  return {
    list_meetings: async (args) => {
      const calendar = requireCalendar(deps);
      const from = readDayStart(args);
      const to = addDays(from, readDays(args));
      return { meetings: await calendar.listMeetings(from, to) };
    },
    next_meeting: async () => {
      const calendar = requireCalendar(deps);
      const meeting = await pickNextMeeting(calendar.listMeetings, new Date());
      return meeting === undefined
        ? { meetings: [], message: 'Встреч в ближайшие 24 часа нет' }
        : { meetings: [meeting] };
    },
    mail_draft_link: async (args) => {
      const owaUrl = requireOwaUrl(deps);
      const result = fitMailDraftLink(owaUrl, {
        to: optionalString(args, 'to'),
        subject: optionalString(args, 'subject'),
        body: optionalString(args, 'body')
      });
      return {
        url: result.url,
        body: result.body,
        hint: result.truncated ? LONG_BODY_HINT : ''
      };
    },
    meeting_draft_link: async (args) => {
      const owaUrl = requireOwaUrl(deps);
      return {
        url: meetingDraftLink(owaUrl, {
          subject: optionalString(args, 'subject'),
          start: requiredString(args, 'start'),
          end: requiredString(args, 'end'),
          location: optionalString(args, 'location'),
          body: optionalString(args, 'body')
        })
      };
    }
  };
}

async function handleCall(
  runs: Record<string, ToolRun>,
  name: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  const run = runs[name];
  if (run === undefined) {
    return errorResult(`Неизвестный инструмент: ${name}`);
  }
  try {
    return textResult(await run(args));
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
}

function textResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function requireCalendar(deps: ExchangeServerOptions): ExchangeCalendar {
  if (deps.calendar === undefined) {
    throw new Error(
      'Календарь недоступен: не заданы EXCHANGE_EWS_URL, EXCHANGE_USER или EXCHANGE_PASSWORD'
    );
  }
  return deps.calendar;
}

function requireOwaUrl(deps: ExchangeServerOptions): string {
  if (deps.owaUrl === undefined) {
    throw new Error('Ссылки недоступны: не задана переменная окружения EXCHANGE_OWA_URL');
  }
  return deps.owaUrl;
}

function readDayStart(args: Record<string, unknown>): Date {
  const value = args.date;
  if (value === undefined || value === null) {
    return startOfToday();
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('Аргумент date должен быть строкой в формате ГГГГ-ММ-ДД');
  }
  const from = new Date(`${value}T00:00:00`);
  if (Number.isNaN(from.getTime())) {
    throw new Error('Аргумент date должен быть существующей датой в формате ГГГГ-ММ-ДД');
  }
  return from;
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function readDays(args: Record<string, unknown>): number {
  const value = args.days;
  if (value === undefined || value === null) {
    return 1;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('Аргумент days должен быть числом');
  }
  return Math.min(Math.max(1, Math.trunc(value)), MAX_DAYS);
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
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
  if (value === undefined) {
    throw new Error(`Аргумент ${name} обязателен`);
  }
  return value;
}
