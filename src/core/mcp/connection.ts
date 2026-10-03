import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpServerConfig } from '../types';

export const CONNECT_TIMEOUT_MS = 10_000;
export const CALL_TIMEOUT_MS = 60_000;
const CLIENT_NAME = 'tishka';
const CLIENT_VERSION = '0.0.0';

export interface McpToolDescription {
  name: string;
  description?: string;
  inputSchema: object;
  annotations?: { readOnlyHint?: boolean };
}

export interface McpToolResponse {
  content?: Array<{ type?: string; text?: string }>;
  isError?: boolean;
}

export interface McpConnection {
  listTools(): Promise<McpToolDescription[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResponse>;
  close(): Promise<void>;
}

export interface McpCredentials {
  headers?: Record<string, string>;
  env?: Record<string, string>;
}

export type McpConnectionFactory = (
  server: McpServerConfig,
  credentials: McpCredentials
) => Promise<McpConnection>;

function clientToConnection(client: Client): McpConnection {
  return {
    async listTools(): Promise<McpToolDescription[]> {
      const tools: McpToolDescription[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.listTools(
          cursor === undefined ? {} : { cursor },
          { timeout: CONNECT_TIMEOUT_MS }
        );
        for (const tool of page.tools) {
          tools.push({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: tool.annotations
          });
        }
        cursor = page.nextCursor;
      } while (cursor !== undefined);
      return tools;
    },
    async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResponse> {
      const result = await client.callTool({ name, arguments: args }, undefined, {
        timeout: CALL_TIMEOUT_MS
      });
      // вариант с toolResult появляется только при задачных возможностях клиента, мы их не включаем
      if ('toolResult' in result) {
        return {};
      }
      return { content: result.content, isError: result.isError };
    },
    close: () => client.close()
  };
}

export const connectMcpServer: McpConnectionFactory = async (server, credentials) => {
  const client = new Client({ name: CLIENT_NAME, version: CLIENT_VERSION });
  try {
    if (server.transport === 'http') {
      const transport = new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: { headers: credentials.headers ?? {} }
      });
      await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS });
    } else {
      const transport = new StdioClientTransport({
        command: server.command,
        args: server.args,
        env: { ...getDefaultEnvironment(), ...credentials.env }
      });
      await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS });
    }
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
  return clientToConnection(client);
};
