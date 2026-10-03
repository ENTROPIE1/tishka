import { createConfluenceClient } from '../mcp-servers/confluence/src/client';

async function main(): Promise<void> {
  const pageId = process.argv[2];
  if (pageId === undefined || pageId.length === 0) {
    console.error('Использование: npx tsx scripts/check-confluence.ts <id страницы>');
    process.exitCode = 1;
    return;
  }
  const baseUrl = process.env.CONFLUENCE_URL;
  const token = process.env.CONFLUENCE_TOKEN;
  if (baseUrl === undefined || token === undefined || baseUrl === '' || token === '') {
    console.error('Нужны переменные окружения CONFLUENCE_URL и CONFLUENCE_TOKEN');
    process.exitCode = 1;
    return;
  }

  const client = createConfluenceClient({ baseUrl, token });
  const version = await client.getPageVersion(pageId);
  const history = await client.getPageHistory(pageId);
  const page = await client.getPage(pageId);
  console.log(`Версия: ${version.version}`);
  console.log(`Обновлена: ${version.updated} (${version.updatedBy})`);
  console.log(`Записей истории: ${history.length}`);
  console.log(`Длина текста: ${page.text.length}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Непредвиденная ошибка');
  process.exitCode = 1;
});
