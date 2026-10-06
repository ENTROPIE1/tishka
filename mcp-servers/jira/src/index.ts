import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createJiraClient } from './client.js';
import { createJiraServer } from './server.js';

async function main(): Promise<void> {
  const baseUrl = readEnv('JIRA_URL');
  const token = optionalEnv('JIRA_TOKEN');
  const user = optionalEnv('JIRA_USER');
  const password = optionalEnv('JIRA_PASSWORD');
  const client = createJiraClient({ baseUrl, token, user, password });
  const server = createJiraServer(client);
  await server.connect(new StdioServerTransport());
}

function readEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    fail(`Jira MCP-сервер: не задана переменная окружения ${name}`);
  }
  return value.trim();
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    return undefined;
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
