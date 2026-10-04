import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTishkaCore, type TishkaCore } from '../src/core/app';
import { createEventBus } from '../src/core/events';
import type { Reply, SecretStore } from '../src/core/types';

const ENV_SECRET_NAMES = ['DKS_API_KEY'];

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

function replyText(reply: Reply): string {
  const parts = [reply.say];
  if (reply.show?.kind === 'text') {
    parts.push(reply.show.markdown);
  } else if (reply.show?.kind === 'list') {
    parts.push(reply.show.items.map((item) => `${item.title} ${item.subtitle ?? ''}`).join('; '));
  }
  return parts.join('\n');
}

function printMemory(core: TishkaCore): void {
  const records = core.memory();
  console.log(`Записей в памяти: ${records.length}`);
  for (const record of records) {
    console.log(`  - ${record.text} [${record.tags.join(', ')}]`);
  }
}

async function main(): Promise<void> {
  if (process.env.DKS_API_KEY === undefined) {
    console.log('Нет переменной окружения DKS_API_KEY — живой шлюз не проверить.');
    return;
  }

  const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const dataDir = await mkdtemp(join(tmpdir(), 'tishka-check-memory-'));
  const events = createEventBus();
  events.on((event) => {
    if (event.type === 'tool.start') {
      console.log(`  · инструмент: ${event.tool}`);
    } else if (event.type === 'error') {
      console.log(`  · ошибка: ${event.message}`);
    }
  });

  const create = (): TishkaCore =>
    createTishkaCore({
      dataDir,
      presetsDir: join(appRoot, 'presets'),
      appRoot,
      secrets: memorySecrets(),
      events,
      openExternal: async () => undefined,
      showPanel: () => undefined,
      now: () => new Date()
    });

  const first = create();
  await first.start();
  console.log('Фраза 1: запомнить почты команды');
  await first.handleUserText(
    'Запомни: Аня Петрова из тестирования, anna@example.ru; Борис Ильин, аналитика, boris@example.ru'
  );
  printMemory(first);
  const saved = first.memory();
  const hasAnna = saved.some((record) => record.text.includes('anna@example.ru'));
  const hasBoris = saved.some((record) => record.text.includes('boris@example.ru'));
  console.log(hasAnna && hasBoris ? 'OK: обе записи на месте' : 'ОШИБКА: не все записи сохранены');
  await first.stop();

  const second = create();
  await second.start();
  console.log('Фраза 2 (новая беседа): кому писать по тестированию');
  const reply = await second.handleUserText('Кому писать по тестированию?');
  const answer = replyText(reply);
  console.log(`Ответ: ${answer}`);
  console.log(answer.includes('anna') ? 'OK: адрес Ани использован' : 'ОШИБКА: адрес Ани не найден');

  console.log('Фраза 3: попытка запомнить пароль');
  await second.handleUserText('Запомни пароль qwerty');
  const leaked = second.memory().some((record) => record.text.toLowerCase().includes('qwerty'));
  console.log(leaked ? 'ОШИБКА: пароль попал в память' : 'OK: пароль не запомнен');
  await second.stop();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Непредвиденная ошибка');
  process.exitCode = 1;
});
