import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createConfluenceClient } from './client.js';
import { createConfluenceServer } from './server.js';

async function main(): Promise<void> {
  const baseUrl = readEnv('CONFLUENCE_URL');
  const token = readEnv('CONFLUENCE_TOKEN');
  const client = createConfluenceClient({ baseUrl, token });
  const server = createConfluenceServer(client);
  await server.connect(new StdioServerTransport());
}

function readEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    fail(`Confluence MCP-сервер: не задана переменная окружения ${name}`);
  }
  return value.trim();
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

main().catch((error: unknown) => {
  process.stderr.write(error instanceof Error ? `${error.message}\n` : 'Непредвиденная ошибка\n');
  process.exit(1);
});
