import { resolveSecrets } from '../secrets/resolve';
import type { McpServerConfig, SecretStore, ToolRegistry, ToolResult } from '../types';
import type { TimingMark } from '../../main/timing-log';
import { createMcpTiming } from './manager-timing';
import {
  connectMcpServer,
  type McpConnection,
  type McpConnectionFactory,
  type McpCredentials,
  type McpToolDescription,
  type McpToolResponse
} from './connection';

export type McpServerState = 'connected' | 'error' | 'disabled';

export interface McpStatus {
  name: string;
  state: McpServerState;
  tools: number;
  error?: string;
}

export interface McpManager {
  connectAll(servers: McpServerConfig[]): Promise<McpStatus[]>;
  reconnect(server: McpServerConfig): Promise<McpStatus>;
  disconnect(name: string): Promise<void>;
  status(): McpStatus[];
  closeAll(): Promise<void>;
}

export interface McpManagerDeps {
  registry: ToolRegistry;
  secrets: SecretStore;
  createConnection?: McpConnectionFactory;
  mark?: TimingMark;
}

interface LiveConnection {
  connection: McpConnection;
  tools: number;
}

const MAX_ERROR_LENGTH = 200;

function shortError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const message = raw.replace(/\s+/g, ' ').trim();
  return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH)}…` : message;
}

function parseJsonData(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function toolResultFromResponse(response: McpToolResponse): ToolResult {
  const content = (response.content ?? [])
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n');
  if (response.isError === true) {
    return { ok: false, content, error: content.length > 0 ? content : 'Инструмент сообщил об ошибке' };
  }
  const data = parseJsonData(content);
  return data === undefined ? { ok: true, content } : { ok: true, content, data };
}

function disabledStatus(name: string): McpStatus {
  return { name, state: 'disabled', tools: 0 };
}

async function credentialsOf(server: McpServerConfig, secrets: SecretStore): Promise<McpCredentials> {
  if (server.transport === 'http') {
    return { headers: server.headers === undefined ? undefined : await resolveSecrets(server.headers, secrets) };
  }
  return { env: server.env === undefined ? undefined : await resolveSecrets(server.env, secrets) };
}

export function createMcpManager(deps: McpManagerDeps): McpManager {
  const connect = deps.createConnection ?? connectMcpServer;
  const timing = createMcpTiming(deps.mark);
  const live = new Map<string, LiveConnection>();
  const statuses = new Map<string, McpStatus>();
  const chains = new Map<string, Promise<unknown>>();

  // Подключения к одному серверу идут строго по очереди: второй вызов ждёт
  // завершения первого, поэтому лишних незакрытых подключений не остаётся.
  function serialize<T>(name: string, task: () => Promise<T>): Promise<T> {
    const previous = chains.get(name) ?? Promise.resolve();
    const result = previous.then(task);
    chains.set(name, result.catch(() => undefined));
    return result;
  }

  async function drop(name: string): Promise<void> {
    const existing = live.get(name);
    if (existing === undefined) {
      return;
    }
    live.delete(name);
    deps.registry.unregisterSource(`mcp:${name}`);
    try {
      await existing.connection.close();
    } catch {
      // подключение могло уже оборваться, это не ошибка отключения
    }
  }

  function registerTool(serverName: string, connection: McpConnection, tool: McpToolDescription): void {
    deps.registry.register(
      {
        name: `${serverName}__${tool.name}`,
        description: tool.description ?? '',
        inputSchema: tool.inputSchema,
        source: `mcp:${serverName}`,
        readOnly: tool.annotations?.readOnlyHint ?? false
      },
      async (args: Record<string, unknown>): Promise<ToolResult> => {
        try {
          const response = await connection.callTool(tool.name, args);
          return toolResultFromResponse(response);
        } catch (error) {
          return { ok: false, content: '', error: shortError(error) };
        }
      }
    );
  }

  async function openOne(server: McpServerConfig): Promise<McpStatus> {
    await drop(server.name);
    const startedAt = timing.start(server.name, server.transport);
    let connection: McpConnection | undefined;
    try {
      const credentials = await credentialsOf(server, deps.secrets);
      connection = await connect(server, credentials);
      const tools = await connection.listTools();
      for (const tool of tools) {
        registerTool(server.name, connection, tool);
      }
      live.set(server.name, { connection, tools: tools.length });
      const status: McpStatus = { name: server.name, state: 'connected', tools: tools.length };
      statuses.set(server.name, status);
      timing.ready(server.name, 'connected', startedAt, { tools: tools.length });
      return status;
    } catch (error) {
      if (connection !== undefined) {
        await connection.close().catch(() => undefined);
      }
      const status: McpStatus = { name: server.name, state: 'error', tools: 0, error: shortError(error) };
      statuses.set(server.name, status);
      timing.ready(server.name, 'error', startedAt, { error: shortError(error) });
      return status;
    }
  }

  function connectOne(server: McpServerConfig): Promise<McpStatus> {
    return serialize(server.name, () => openOne(server));
  }

  return {
    async connectAll(servers: McpServerConfig[]): Promise<McpStatus[]> {
      const results: McpStatus[] = [];
      for (const server of servers) {
        results.push(await connectOne(server));
      }
      return results;
    },

    reconnect(server: McpServerConfig): Promise<McpStatus> {
      return connectOne(server);
    },

    async disconnect(name: string): Promise<void> {
      const known = statuses.has(name) || live.has(name);
      await serialize(name, () => drop(name));
      if (known) {
        statuses.set(name, disabledStatus(name));
      }
    },

    status(): McpStatus[] {
      return [...statuses.values()];
    },

    async closeAll(): Promise<void> {
      const names = new Set([...statuses.keys(), ...live.keys(), ...chains.keys()]);
      for (const name of names) {
        await serialize(name, () => drop(name));
        statuses.set(name, disabledStatus(name));
      }
    }
  };
}
