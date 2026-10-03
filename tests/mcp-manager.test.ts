import { describe, expect, it, vi } from 'vitest';
import { createEventBus } from '../src/core/events';
import type {
  McpConnection,
  McpCredentials,
  McpConnectionFactory,
  McpToolDescription,
  McpToolResponse
} from '../src/core/mcp/connection';
import { createMcpManager } from '../src/core/mcp/manager';
import { createToolRegistry } from '../src/core/tools/registry';
import type { McpServerConfig, SecretStore, ToolDef } from '../src/core/types';

function fakeSecrets(values: Record<string, string>): SecretStore {
  return {
    set: vi.fn(async () => undefined),
    get: vi.fn(async (name: string) => values[name]),
    has: vi.fn(async (name: string) => name in values),
    delete: vi.fn(async () => undefined),
    names: vi.fn(async () => Object.keys(values))
  };
}

interface FakeSpec {
  tools: McpToolDescription[];
  fail?: string;
  call?: (name: string, args: Record<string, unknown>) => Promise<McpToolResponse>;
  calls: Array<{ name: string; args: Record<string, unknown> }>;
}

function makeSpec(tools: McpToolDescription[]): FakeSpec {
  return { tools, calls: [] };
}

function mcpTool(name: string, readOnlyHint?: boolean): McpToolDescription {
  return {
    name,
    description: `Описание инструмента ${name}`,
    inputSchema: { type: 'object', properties: {} },
    annotations: readOnlyHint === undefined ? undefined : { readOnlyHint }
  };
}

function fakeFactory(
  specs: Map<string, FakeSpec>,
  resolved: Map<string, McpCredentials>,
  closed: string[]
): McpConnectionFactory {
  return async (server, credentials) => {
    resolved.set(server.name, credentials);
    const spec = specs.get(server.name);
    if (spec === undefined) {
      throw new Error(`нет спецификации для ${server.name}`);
    }
    if (spec.fail !== undefined) {
      throw new Error(spec.fail);
    }
    const connection: McpConnection = {
      listTools: async () => spec.tools,
      callTool: async (name, args) => {
        spec.calls.push({ name, args });
        return spec.call === undefined ? { content: [{ type: 'text', text: 'ок' }] } : await spec.call(name, args);
      },
      close: async () => {
        closed.push(server.name);
      }
    };
    return connection;
  };
}

const httpServer = (name: string): McpServerConfig => ({
  name,
  transport: 'http',
  url: `https://${name}.example.org`
});

function defsOfSource(registry: { list(): ToolDef[] }, source: ToolDef['source']): ToolDef[] {
  return registry.list().filter((def) => def.source === source);
}

describe('createMcpManager', () => {
  it('регистрирует инструменты сервера с именем, источником и readOnly', async () => {
    const registry = createToolRegistry(createEventBus());
    const specs = new Map([
      ['confluence', makeSpec([mcpTool('get_page', true), mcpTool('create_page')])]
    ]);
    const manager = createMcpManager({
      registry,
      secrets: fakeSecrets({}),
      createConnection: fakeFactory(specs, new Map(), [])
    });

    const statuses = await manager.connectAll([httpServer('confluence')]);

    expect(statuses).toEqual([{ name: 'confluence', state: 'connected', tools: 2 }]);
    const defs = registry.list();
    expect(defs.find((def) => def.name === 'confluence__get_page')).toMatchObject({
      description: 'Описание инструмента get_page',
      source: 'mcp:confluence',
      readOnly: true
    });
    expect(defs.find((def) => def.name === 'confluence__create_page')).toMatchObject({
      source: 'mcp:confluence',
      readOnly: false
    });
  });

  it('вызов через реестр доходит до сервера и возвращает content и data', async () => {
    const registry = createToolRegistry(createEventBus());
    const specs = new Map([
      ['confluence', makeSpec([mcpTool('search')])]
    ]);
    specs.get('confluence')!.call = async () => ({
      content: [{ type: 'text', text: '{"pages":["одна"]}' }]
    });
    const manager = createMcpManager({
      registry,
      secrets: fakeSecrets({}),
      createConnection: fakeFactory(specs, new Map(), [])
    });
    await manager.connectAll([httpServer('confluence')]);

    const result = await registry.call('confluence__search', { query: 'отчёт' });

    expect(result).toEqual({
      ok: true,
      content: '{"pages":["одна"]}',
      data: { pages: ['одна'] }
    });
    expect(specs.get('confluence')!.calls).toEqual([{ name: 'search', args: { query: 'отчёт' } }]);
  });

  it('ответ с признаком ошибки превращается в ok: false', async () => {
    const registry = createToolRegistry(createEventBus());
    const specs = new Map([
      ['confluence', makeSpec([mcpTool('get_page')])]
    ]);
    specs.get('confluence')!.call = async () => ({
      content: [{ type: 'text', text: 'страница не найдена' }],
      isError: true
    });
    const manager = createMcpManager({
      registry,
      secrets: fakeSecrets({}),
      createConnection: fakeFactory(specs, new Map(), [])
    });
    await manager.connectAll([httpServer('confluence')]);

    await expect(registry.call('confluence__get_page', {})).resolves.toEqual({
      ok: false,
      content: 'страница не найдена',
      error: 'страница не найдена'
    });
  });

  it('исключение при вызове инструмента возвращается как ok: false', async () => {
    const registry = createToolRegistry(createEventBus());
    const specs = new Map([
      ['confluence', makeSpec([mcpTool('get_page')])]
    ]);
    specs.get('confluence')!.call = async () => {
      throw new Error('отвало по таймауту');
    };
    const manager = createMcpManager({
      registry,
      secrets: fakeSecrets({}),
      createConnection: fakeFactory(specs, new Map(), [])
    });
    await manager.connectAll([httpServer('confluence')]);

    await expect(registry.call('confluence__get_page', {})).resolves.toEqual({
      ok: false,
      content: '',
      error: 'отвало по таймауту'
    });
  });

  it('сбой одного сервера даёт статус error, инструменты второго работают', async () => {
    const registry = createToolRegistry(createEventBus());
    const specs = new Map([
      ['broken', makeSpec([])],
      ['good', makeSpec([mcpTool('ping', true)])]
    ]);
    specs.get('broken')!.fail = 'connection refused';
    const manager = createMcpManager({
      registry,
      secrets: fakeSecrets({}),
      createConnection: fakeFactory(specs, new Map(), [])
    });

    const statuses = await manager.connectAll([httpServer('broken'), httpServer('good')]);

    expect(statuses[0]).toMatchObject({ name: 'broken', state: 'error', tools: 0 });
    expect(statuses[0].error).toContain('connection refused');
    expect(statuses[1]).toMatchObject({ name: 'good', state: 'connected', tools: 1 });
    await expect(registry.call('good__ping', {})).resolves.toMatchObject({ ok: true });
  });

  it('после disconnect инструментов сервера в реестре нет', async () => {
    const registry = createToolRegistry(createEventBus());
    const specs = new Map([['confluence', makeSpec([mcpTool('get_page', true)])]]);
    const closed: string[] = [];
    const manager = createMcpManager({
      registry,
      secrets: fakeSecrets({}),
      createConnection: fakeFactory(specs, new Map(), closed)
    });
    await manager.connectAll([httpServer('confluence')]);

    await manager.disconnect('confluence');

    expect(defsOfSource(registry, 'mcp:confluence')).toEqual([]);
    await expect(registry.call('confluence__get_page', {})).resolves.toMatchObject({ ok: false });
    expect(manager.status()).toEqual([{ name: 'confluence', state: 'disabled', tools: 0 }]);
    expect(closed).toEqual(['confluence']);
  });

  it('reconnect заменяет старые инструменты и закрывает прежнее подключение', async () => {
    const registry = createToolRegistry(createEventBus());
    const specs = new Map([['confluence', makeSpec([mcpTool('get_page', true)])]]);
    const closed: string[] = [];
    const manager = createMcpManager({
      registry,
      secrets: fakeSecrets({}),
      createConnection: fakeFactory(specs, new Map(), closed)
    });
    await manager.connectAll([httpServer('confluence')]);

    specs.set('confluence', makeSpec([mcpTool('search')]));
    const status = await manager.reconnect(httpServer('confluence'));

    expect(status).toEqual({ name: 'confluence', state: 'connected', tools: 1 });
    expect(defsOfSource(registry, 'mcp:confluence').map((def) => def.name)).toEqual(['confluence__search']);
    expect(closed).toEqual(['confluence']);
  });

  it('подставляет секрет в заголовок и не показывает значение в ошибке', async () => {
    const registry = createToolRegistry(createEventBus());
    const specs = new Map([['api', makeSpec([mcpTool('ping', true)])]]);
    const resolved = new Map<string, McpCredentials>();
    const manager = createMcpManager({
      registry,
      secrets: fakeSecrets({ CONFLUENCE_TOKEN: 'super-secret' }),
      createConnection: fakeFactory(specs, resolved, [])
    });

    await manager.connectAll([
      {
        name: 'api',
        transport: 'http',
        url: 'https://api.example.org',
        headers: { Authorization: 'Bearer ${secret:CONFLUENCE_TOKEN}' }
      }
    ]);
    expect(resolved.get('api')?.headers?.Authorization).toBe('Bearer super-secret');

    const statuses = await manager.connectAll([
      {
        name: 'broken',
        transport: 'http',
        url: 'https://broken.example.org',
        headers: { Authorization: 'Bearer ${secret:ABSENT}' }
      }
    ]);

    expect(statuses[0]).toMatchObject({ name: 'broken', state: 'error' });
    expect(statuses[0].error).toContain('ABSENT');
    expect(JSON.stringify(manager.status())).not.toContain('super-secret');
  });

  it('подставляет секрет в env для stdio-сервера', async () => {
    const registry = createToolRegistry(createEventBus());
    const specs = new Map([['confluence', makeSpec([])]]);
    const resolved = new Map<string, McpCredentials>();
    const manager = createMcpManager({
      registry,
      secrets: fakeSecrets({ CONFLUENCE_TOKEN: 'token-value' }),
      createConnection: fakeFactory(specs, resolved, [])
    });

    await manager.connectAll([
      {
        name: 'confluence',
        transport: 'stdio',
        command: 'node',
        args: ['mcp-servers/confluence/dist/index.js'],
        env: {
          CONFLUENCE_URL: 'https://wiki.example.org',
          CONFLUENCE_TOKEN: '${secret:CONFLUENCE_TOKEN}'
        }
      }
    ]);

    expect(resolved.get('confluence')?.env).toEqual({
      CONFLUENCE_URL: 'https://wiki.example.org',
      CONFLUENCE_TOKEN: 'token-value'
    });
  });

  it('closeAll отключает все серверы и чистит реестр', async () => {
    const registry = createToolRegistry(createEventBus());
    const specs = new Map([
      ['one', makeSpec([mcpTool('a')])],
      ['two', makeSpec([mcpTool('b')])]
    ]);
    const closed: string[] = [];
    const manager = createMcpManager({
      registry,
      secrets: fakeSecrets({}),
      createConnection: fakeFactory(specs, new Map(), closed)
    });
    await manager.connectAll([httpServer('one'), httpServer('two')]);

    await manager.closeAll();

    expect(registry.list()).toEqual([]);
    expect(manager.status()).toEqual([
      { name: 'one', state: 'disabled', tools: 0 },
      { name: 'two', state: 'disabled', tools: 0 }
    ]);
    expect(closed).toEqual(['one', 'two']);
  });
});
