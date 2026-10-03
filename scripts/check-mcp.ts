import { connectMcpServer } from '../src/core/mcp/connection';
import type { McpServerConfig } from '../src/core/types';

async function main(): Promise<void> {
  const url = process.argv[2];
  if (url === undefined || url.length === 0) {
    console.error('Использование: npx tsx scripts/check-mcp.ts <адрес>');
    process.exitCode = 1;
    return;
  }

  const server: McpServerConfig = { name: 'check', transport: 'http', url };
  const connection = await connectMcpServer(server, {});
  try {
    const tools = await connection.listTools();
    if (tools.length === 0) {
      console.log('Сервер не отдал ни одного инструмента');
      return;
    }
    for (const tool of tools) {
      const readOnly = tool.annotations?.readOnlyHint === true ? ' [только чтение]' : '';
      console.log(`${tool.name}${readOnly}`);
      console.log(`  ${tool.description ?? '(без описания)'}`);
    }
  } finally {
    await connection.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Непредвиденная ошибка');
  process.exitCode = 1;
});
