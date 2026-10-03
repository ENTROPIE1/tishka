import { spawn } from 'node:child_process';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { createTishkaCore } from '../src/core/app';
import { createEventBus } from '../src/core/events';
import type { Panel, Reply, SecretStore, TishkaEvent } from '../src/core/types';

const ENV_SECRET_NAMES = ['DKS_API_KEY', 'CONFLUENCE_TOKEN', 'EXCHANGE_PASSWORD'];

function memorySecrets(): SecretStore {
  const values = new Map<string, string>();
  for (const name of ENV_SECRET_NAMES) {
    const value = process.env[name];
    if (value !== undefined) {
      values.set(name, value);
    }
  }
  return {
    async set(name, value) {
      values.set(name, value);
    },
    async get(name) {
      return values.get(name);
    },
    async has(name) {
      return values.has(name);
    },
    async delete(name) {
      values.delete(name);
    },
    async names() {
      return [...values.keys()];
    }
  };
}

function parseArgs(argv: string[]): { dataDir?: string; open: boolean } {
  const result: { dataDir?: string; open: boolean } = { open: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--data' && index + 1 < argv.length) {
      result.dataDir = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--data=')) {
      result.dataDir = arg.slice('--data='.length);
    } else if (arg === '--open') {
      result.open = true;
    }
  }
  return result;
}

function openInBrowser(url: string): void {
  if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

function printPanel(panel: Panel): void {
  console.log(`  ${panel.title}`);
  if (panel.kind === 'text') {
    console.log(panel.markdown);
    return;
  }
  if (panel.kind === 'list') {
    for (const item of panel.items) {
      const subtitle = item.subtitle === undefined ? '' : ` (${item.subtitle})`;
      const url = item.url === undefined ? '' : ` ${item.url}`;
      console.log(`  - ${item.title}${subtitle}${url}`);
    }
    return;
  }
  console.log(`  ${panel.path}`);
}

function printReply(reply: Reply): void {
  console.log(`Тишка: ${reply.say}`);
  if (reply.show !== undefined) {
    printPanel(reply.show);
  }
}

function printEvent(event: TishkaEvent): void {
  if (event.type === 'tool.start') {
    console.log(`  · инструмент: ${event.tool}`);
  } else if (event.type === 'notify') {
    console.log(`  · уведомление: ${event.title}`);
  } else if (event.type === 'error') {
    console.log(`  · ошибка: ${event.message}`);
  }
}

async function countSkills(dataDir: string): Promise<number> {
  try {
    const entries = await readdir(join(dataDir, 'skills'));
    return entries.filter((name) => name.endsWith('.tishka.json')).length;
  } catch {
    return 0;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const dataDir = args.dataDir ?? (await mkdtemp(join(tmpdir(), 'tishka-chat-')));
  const events = createEventBus();
  events.on(printEvent);

  const core = createTishkaCore({
    dataDir,
    presetsDir: join(appRoot, 'presets'),
    appRoot,
    secrets: memorySecrets(),
    events,
    openExternal: async (url) => {
      console.log(`  · ссылка: ${url}`);
      if (args.open) {
        openInBrowser(url);
      }
    },
    showPanel: () => undefined,
    now: () => new Date()
  });

  await core.start();

  console.log(`Каталог данных: ${dataDir}`);
  for (const status of core.mcpStatus()) {
    console.log(`MCP ${status.name}: ${status.state}, инструментов: ${status.tools}`);
  }
  console.log(`Навыков: ${await countSkills(dataDir)}`);
  console.log('Введите фразу, /exit — выход.');

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    process.stdout.write('> ');
    // Итератор отдаёт строки по порядку и сам завершается, когда ввод закрыт.
    for await (const line of rl) {
      const text = line.trim();
      if (text === '/exit') {
        break;
      }
      if (text !== '') {
        printReply(await core.handleUserText(text));
      }
      process.stdout.write('> ');
    }
  } finally {
    rl.close();
    await core.stop();
  }
  console.log('Пока!');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Непредвиденная ошибка');
  process.exitCode = 1;
});
