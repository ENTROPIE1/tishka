import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool
} from '@modelcontextprotocol/sdk/types.js';
import type { ConfluenceClient } from './client';

export interface ConfluenceServerOptions {
  name?: string;
  version?: string;
}

const PAGE_ID_PROPERTY = {
  description: 'Идентификатор страницы Confluence, только цифры',
  oneOf: [
    { type: 'string', pattern: '^[0-9]+$' },
    { type: 'number' }
  ]
};

const LIMIT_PROPERTY = {
  description: 'Сколько записей вернуть, по умолчанию 10, не больше 50',
  type: 'number',
  minimum: 1,
  maximum: 50
};

const TOOLS: Tool[] = [
  {
    name: 'get_page_version',
    description: 'Возвращает номер версии, дату, автора, название и ссылку страницы Confluence.',
    inputSchema: {
      type: 'object',
      properties: { page_id: PAGE_ID_PROPERTY },
      required: ['page_id']
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'get_page',
    description: 'Возвращает версию и очищенный от разметки текст страницы Confluence.',
    inputSchema: {
      type: 'object',
      properties: { page_id: PAGE_ID_PROPERTY },
      required: ['page_id']
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'get_page_history',
    description: 'Возвращает историю версий страницы Confluence с датами, авторами и комментариями.',
    inputSchema: {
      type: 'object',
      properties: { page_id: PAGE_ID_PROPERTY, limit: LIMIT_PROPERTY },
      required: ['page_id']
    },
    annotations: { readOnlyHint: true }
  },
  {
    name: 'search_pages',
    description: 'Ищет страницы Confluence по тексту и возвращает их идентификаторы, названия и ссылки.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, limit: LIMIT_PROPERTY },
      required: ['query']
    },
    annotations: { readOnlyHint: true }
  }
];

type ToolRun = (args: Record<string, unknown>) => Promise<unknown>;

function toolRuns(client: ConfluenceClient): Record<string, ToolRun> {
  return {
    get_page_version: async (args) => client.getPageVersion(readPageId(args)),
    get_page: async (args) => client.getPage(readPageId(args)),
    get_page_history: async (args) => client.getPageHistory(readPageId(args), readLimit(args)),
    search_pages: async (args) => client.searchPages(readQuery(args), readLimit(args))
  };
}

export function createConfluenceServer(
  client: ConfluenceClient,
  options: ConfluenceServerOptions = {}
): Server {
  const server = new Server(
    { name: options.name ?? 'confluence', version: options.version ?? '0.0.0' },
    { capabilities: { tools: {} } }
  );
  const runs = toolRuns(client);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    handleCall(runs, request.params.name, request.params.arguments ?? {})
  );

  return server;
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

function readPageId(args: Record<string, unknown>): string {
  const value = args.page_id;
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'string') {
    return value;
  }
  throw new Error('Аргумент page_id должен быть строкой или числом');
}

function readQuery(args: Record<string, unknown>): string {
  const value = args.query;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('Аргумент query должен быть непустой строкой');
  }
  return value;
}

function readLimit(args: Record<string, unknown>): number | undefined {
  const value = args.limit;
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'number') {
    throw new Error('Аргумент limit должен быть числом');
  }
  return value;
}
