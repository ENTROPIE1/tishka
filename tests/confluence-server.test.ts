import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ConfluenceClient, PageVersion } from '../mcp-servers/confluence/src/client';
import { createConfluenceServer } from '../mcp-servers/confluence/src/server';

function makeVersion(): PageVersion {
  return {
    id: '123',
    title: 'Инструкция',
    url: 'https://wiki.example.org/pages/123',
    version: 7,
    updated: '2026-09-01T10:00:00Z',
    updatedBy: 'Иван'
  };
}

function fakeClient(): ConfluenceClient {
  const version = makeVersion();
  return {
    getPageVersion: async () => version,
    getPage: async () => ({ ...version, text: 'текст', truncated: false }),
    getPageHistory: async () => [{ version: 7, when: version.updated, by: version.updatedBy, message: '' }],
    searchPages: async () => [{ id: version.id, title: version.title, url: version.url }]
  };
}

async function connect(): Promise<{ client: Client; close: () => Promise<void> }> {
  const server = createConfluenceServer(fakeClient());
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

describe('createConfluenceServer', () => {
  it('объявляет четыре инструмента с readOnlyHint', async () => {
    const session = await connect();
    try {
      const { tools } = await session.client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        'get_page',
        'get_page_history',
        'get_page_version',
        'search_pages'
      ]);
      for (const tool of tools) {
        expect(tool.annotations?.readOnlyHint).toBe(true);
      }
    } finally {
      await session.close();
    }
  });

  it('get_page_version возвращает JSON с полем version', async () => {
    const session = await connect();
    try {
      const result = (await session.client.callTool({
        name: 'get_page_version',
        arguments: { page_id: 123 }
      })) as CallToolResult;
      expect(result.isError).toBeUndefined();
      const block = result.content[0] as { type: string; text: string };
      const data = JSON.parse(block.text) as PageVersion;
      expect(data.version).toBe(7);
      expect(data.title).toBe('Инструкция');
    } finally {
      await session.close();
    }
  });

  it('ошибка клиента приходит как isError с текстом ошибки', async () => {
    const server = createConfluenceServer({
      getPageVersion: async () => {
        throw new Error('Страница не найдена');
      },
      getPage: async () => {
        throw new Error('Страница не найдена');
      },
      getPageHistory: async () => [],
      searchPages: async () => []
    });
    const mcpClient = new Client({ name: 'test', version: '0.0.0' });
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await mcpClient.connect(clientTransport);
    try {
      const result = (await mcpClient.callTool({
        name: 'get_page',
        arguments: { page_id: '999' }
      })) as CallToolResult;
      expect(result.isError).toBe(true);
      const block = result.content[0] as { type: string; text: string };
      expect(block.text).toBe('Страница не найдена');
    } finally {
      await mcpClient.close();
      await server.close();
    }
  });
});
