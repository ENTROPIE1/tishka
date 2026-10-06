import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createJiraClient } from '../mcp-servers/jira/src/client';
import { createJiraServer, type JiraServerOptions } from '../mcp-servers/jira/src/server';

interface CapturedRequest {
  url: string;
  init?: RequestInit;
}

function jsonResponse(data: unknown, status = 200): unknown {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

const ISSUE = {
  key: 'ABC-123',
  fields: {
    summary: 'Починить вход',
    status: { name: 'В работе' },
    issuetype: { name: 'Ошибка' },
    priority: { name: 'Высокий' },
    assignee: { displayName: 'Иван' },
    reporter: { displayName: 'Аня' },
    created: '2026-09-01T10:00:00.000+0300',
    updated: '2026-09-02T11:00:00.000+0300',
    description: 'h1. Проблема\n* шаг',
    comment: {
      comments: [
        { author: { displayName: 'Новый' }, created: '2026-09-03T10:00:00.000+0300', body: 'второй' },
        { author: { displayName: 'Старый' }, created: '2026-09-01T10:00:00.000+0300', body: 'первый' }
      ]
    }
  }
};

const SEARCH = {
  issues: [
    { key: 'ABC-1', fields: { summary: 'A', status: { name: 'В работе' }, assignee: { displayName: 'И' }, updated: '2026-09-03' } },
    { key: 'ABC-2', fields: { summary: 'B', status: { name: 'Открыта' }, assignee: { displayName: 'И' }, updated: '2026-09-02' } },
    { key: 'ABC-3', fields: { summary: 'C', status: { name: 'В работе' }, assignee: { displayName: 'И' }, updated: '2026-09-01' } }
  ]
};

function dispatch(
  requests: CapturedRequest[],
  searchData: unknown = SEARCH,
  issueStatus = 200
): typeof fetch {
  return (async (url: unknown, init?: unknown) => {
    requests.push({ url: String(url), init: init as RequestInit | undefined });
    const path = new URL(String(url)).pathname;
    if (path.endsWith('/comment')) {
      return jsonResponse({ comments: [] });
    }
    if (path === '/rest/api/2/search') {
      return jsonResponse(searchData);
    }
    return jsonResponse(ISSUE, issueStatus);
  }) as unknown as typeof fetch;
}

async function connect(
  requests: CapturedRequest[] = [],
  options: JiraServerOptions = {},
  issueStatus = 200
): Promise<{ client: Client; close: () => Promise<void> }> {
  const jira = createJiraClient({
    baseUrl: 'https://jira.example.org',
    token: 'secret-token',
    fetch: dispatch(requests, SEARCH, issueStatus)
  });
  const server = createJiraServer(jira, options);
  const mcpClient = new Client({ name: 'test', version: '0.0.0' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcpClient.connect(clientTransport);
  return {
    client: mcpClient,
    close: async () => {
      await mcpClient.close();
      await server.close();
    }
  };
}

function parse(result: CallToolResult): unknown {
  const block = result.content[0] as { type: string; text: string };
  return JSON.parse(block.text);
}

describe('createJiraServer', () => {
  it('объявляет четыре инструмента с readOnlyHint', async () => {
    const session = await connect();
    try {
      const { tools } = await session.client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        'jira_comments',
        'jira_issue',
        'jira_my_issues',
        'jira_search'
      ]);
      for (const tool of tools) {
        expect(tool.annotations?.readOnlyHint).toBe(true);
      }
    } finally {
      await session.close();
    }
  });

  it('jira_issue возвращает задачу с описанием и комментариями', async () => {
    const session = await connect();
    try {
      const result = (await session.client.callTool({ name: 'jira_issue', arguments: { key: 'ABC-123' } })) as CallToolResult;
      expect(result.isError).toBeUndefined();
      const data = parse(result) as { key: string; description: string; comments: { body: string }[] };
      expect(data.key).toBe('ABC-123');
      expect(data.description).toBe('Проблема\nшаг');
      expect(data.comments.map((comment) => comment.body)).toEqual(['первый', 'второй']);
    } finally {
      await session.close();
    }
  });

  it('jira_search по JQL возвращает список', async () => {
    const session = await connect();
    try {
      const result = (await session.client.callTool({ name: 'jira_search', arguments: { jql: 'project = "ABC"', limit: 5 } })) as CallToolResult;
      const data = parse(result) as { key: string }[];
      expect(data).toHaveLength(3);
      expect(data[0].key).toBe('ABC-1');
    } finally {
      await session.close();
    }
  });

  it('jira_my_issues группирует по статусу', async () => {
    const session = await connect();
    try {
      const result = (await session.client.callTool({ name: 'jira_my_issues', arguments: {} })) as CallToolResult;
      const data = parse(result) as {
        total: number;
        groups: { status: string; issues: { key: string }[] }[];
      };
      expect(data.total).toBe(3);
      expect(data.groups).toEqual([
        { status: 'В работе', issues: [expect.objectContaining({ key: 'ABC-1' }), expect.objectContaining({ key: 'ABC-3' })] },
        { status: 'Открыта', issues: [expect.objectContaining({ key: 'ABC-2' })] }
      ]);
    } finally {
      await session.close();
    }
  });

  it('404 по несуществующему ключу приходит как isError', async () => {
    const session = await connect([], {}, 404);
    try {
      const result = (await session.client.callTool({
        name: 'jira_issue',
        arguments: { key: 'ABC-999' }
      })) as CallToolResult;
      expect(result.isError).toBe(true);
      const block = result.content[0] as { text: string };
      expect(block.text).toBe('Задача не найдена');
    } finally {
      await session.close();
    }
  });

  it('ни один инструмент не шлёт запросов кроме GET и POST на /rest/api/2/search', async () => {
    const requests: CapturedRequest[] = [];
    const session = await connect(requests);
    try {
      await session.client.callTool({ name: 'jira_issue', arguments: { key: 'ABC-123' } });
      await session.client.callTool({ name: 'jira_search', arguments: { jql: 'project = "ABC"' } });
      await session.client.callTool({ name: 'jira_my_issues', arguments: {} });
      await session.client.callTool({ name: 'jira_comments', arguments: { key: 'ABC-123' } });
    } finally {
      await session.close();
    }

    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      const method = request.init?.method ?? 'GET';
      if (method === 'POST') {
        expect(request.url).toBe('https://jira.example.org/rest/api/2/search');
      } else {
        expect(method).toBe('GET');
      }
    }
  });
});
