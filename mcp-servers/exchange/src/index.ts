import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createExchangeClient } from './client.js';
import { createMailClient } from './mail.js';
import { createExchangeServer } from './server.js';

async function main(): Promise<void> {
  const ewsUrl = optionalEnv('EXCHANGE_EWS_URL');
  const user = optionalEnv('EXCHANGE_USER');
  const password = optionalEnv('EXCHANGE_PASSWORD');
  const owaUrl = optionalEnv('EXCHANGE_OWA_URL');

  const credentials =
    ewsUrl !== undefined && user !== undefined && password !== undefined
      ? { ewsUrl, user, password }
      : undefined;
  const calendar = credentials === undefined ? undefined : createExchangeClient(credentials);
  const mail = credentials === undefined ? undefined : createMailClient(credentials);

  if (credentials === undefined) {
    process.stderr.write(
      'Exchange MCP-сервер: не заданы EXCHANGE_EWS_URL, EXCHANGE_USER или EXCHANGE_PASSWORD, ' +
        'инструменты календаря и почты вернут ошибку\n'
    );
  }
  if (owaUrl === undefined) {
    process.stderr.write(
      'Exchange MCP-сервер: не задана EXCHANGE_OWA_URL, инструменты ссылок вернут ошибку\n'
    );
  }

  const server = createExchangeServer({ calendar, mail, owaUrl });
  await server.connect(new StdioServerTransport());
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  return value.trim();
}

main().catch((error: unknown) => {
  process.stderr.write(error instanceof Error ? `${error.message}\n` : 'Непредвиденная ошибка\n');
  process.exit(1);
});
