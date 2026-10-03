import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTishkaCore, type TishkaCore } from '../src/core/app';
import { defaultConfig } from '../src/core/config';
import { createEventBus } from '../src/core/events';
import type { SecretStore, TishkaEvent } from '../src/core/types';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const presetsDir = join(root, 'presets');
const FIXED_NOW = new Date('2026-10-02T10:00:00');

const delay = (ms: number): Promise<void> =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

function fakeSecrets(values: Record<string, string>): SecretStore {
  const map = new Map(Object.entries(values));
  return {
    async set(name, value) {
      map.set(name, value);
    },
    async get(name) {
      return map.get(name);
    },
    async has(name) {
      return map.has(name);
    },
    async delete(name) {
      map.delete(name);
    },
    async names() {
      return [...map.keys()];
    }
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

function choice(message: Record<string, unknown>): Response {
  return jsonResponse({ choices: [{ message }] });
}

function replyChoice(id: string, say: string): Response {
  return choice({
    content: null,
    tool_calls: [{ id, type: 'function', function: { name: 'reply', arguments: JSON.stringify({ say }) } }]
  });
}

function toolChoice(id: string, name: string, args: Record<string, unknown>): Response {
  return choice({
    content: null,
    tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }]
  });
}

async function removeDir(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch {
      await delay(100);
    }
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('Не дождались нужного состояния');
    }
    await delay(25);
  }
}

const pendingCleanup: Array<() => Promise<void>> = [];

async function setup(options: { fetch?: typeof fetch; secrets?: Record<string, string>; config?: unknown } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'tishka-app-'));
  if (options.config !== undefined) {
    await writeFile(join(dataDir, 'config.json'), JSON.stringify(options.config), 'utf8');
  }
  const bus = createEventBus();
  const events: TishkaEvent[] = [];
  bus.on((event) => events.push(event));
  const openExternal = vi.fn(async () => undefined);
  const core: TishkaCore = createTishkaCore({
    dataDir,
    presetsDir,
    appRoot: root,
    secrets: fakeSecrets(options.secrets ?? { DKS_API_KEY: 'test-key' }),
    events: bus,
    openExternal,
    showPanel: () => undefined,
    now: () => FIXED_NOW,
    fetch: options.fetch
  });
  await core.start();
  pendingCleanup.push(async () => {
    await core.stop();
    await removeDir(dataDir);
  });
  return { core, events, openExternal, dataDir };
}

afterEach(async () => {
  vi.unstubAllGlobals();
  while (pendingCleanup.length > 0) {
    const task = pendingCleanup.pop();
    if (task !== undefined) {
      await task();
    }
  }
});

describe('createTishkaCore', () => {
  it('после start() в пустом каталоге данных появились пресеты, config() даёт значения по умолчанию', async () => {
    const { core, dataDir } = await setup();

    const files = await readdir(join(dataDir, 'skills'));

    expect(files).toEqual(expect.arrayContaining(['friday-morning.tishka.json', 'watch-page.tishka.json']));
    expect(core.config()).toEqual(defaultConfig());
    expect(core.mcpStatus()).toEqual([]);
  });

  it('фраза «утро пятницы» запускает пресет: ссылки открыты, модель не вызывалась', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => choice({ content: 'ок' }));
    const { core, openExternal, events } = await setup({ fetch: fetchMock });

    const reply = await core.handleUserText('утро пятницы');

    expect(reply.say).toBe('Открыл всё для пятницы');
    expect(openExternal).toHaveBeenCalledTimes(2);
    expect(openExternal).toHaveBeenCalledWith('https://example.org/friday');
    expect(openExternal).toHaveBeenCalledWith('https://example.org/plan');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(events.at(-1)?.type).toBe('idle');
  });

  it('фраза без подходящего навыка уходит модели, ответ через reply возвращается', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => replyChoice('r1', 'Привет! Я Тишка.'));
    const { core, events } = await setup({ fetch: fetchMock });

    const reply = await core.handleUserText('расскажи о себе');

    expect(reply).toEqual({ say: 'Привет! Я Тишка.', mood: 'neutral' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(events.find((event) => event.type === 'reply')).toMatchObject({
      reply: { say: 'Привет! Я Тишка.' }
    });
    expect(events.at(-1)?.type).toBe('idle');
  });

  it('модель вызывает create_reminder — напоминание появляется в triggers.json', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(toolChoice('c1', 'create_reminder', { time: '12:00', text: 'выпить воды' }))
      .mockResolvedValueOnce(replyChoice('r1', 'Записал, напомню в срок.'));
    const { core, dataDir, events } = await setup({ fetch: fetchMock });

    const reply = await core.handleUserText('напомни выпить воды');

    expect(reply.say).toBe('Записал, напомню в срок.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const raw = await readFile(join(dataDir, 'triggers.json'), 'utf8');
    const state = JSON.parse(raw) as { reminders: Array<{ text: string; done: boolean }> };
    expect(state.reminders).toHaveLength(1);
    expect(state.reminders[0]).toMatchObject({ text: 'выпить воды', done: false });
    expect(events.at(-1)?.type).toBe('idle');
  });

  it('нет ключа DKS_API_KEY — ответ с mood confused и без исключения', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => choice({ content: 'ок' }));
    const { core } = await setup({ fetch: fetchMock, secrets: {} });

    const reply = await core.handleUserText('привет');

    expect(reply.mood).toBe('confused');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('сервер MCP с несуществующей командой даёт статус error, остальное работает', async () => {
    const { core } = await setup({
      config: {
        mcpServers: [{ name: 'broken', transport: 'stdio', command: 'tishka-no-such-command', args: [] }]
      }
    });

    await waitFor(() => core.mcpStatus().some((status) => status.name === 'broken' && status.state === 'error'));

    const status = core.mcpStatus().find((item) => item.name === 'broken');
    expect(status?.state).toBe('error');
    expect(status?.tools).toBe(0);

    const reply = await core.handleUserText('утро пятницы');
    expect(reply.say).toBe('Открыл всё для пятницы');
    expect(core.config().mcpServers).toHaveLength(1);
  }, 20_000);

  it('две фразы подряд обрабатываются по очереди, а не одновременно', async () => {
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    const fetchMock = vi.fn<typeof fetch>(async () => {
      calls += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(30);
      active -= 1;
      return replyChoice(`r${calls}`, 'отвечаю');
    });
    const { core, events } = await setup({ fetch: fetchMock });

    const [first, second] = await Promise.all([
      core.handleUserText('привет'),
      core.handleUserText('как дела')
    ]);

    expect(first.say).toBe('отвечаю');
    expect(second.say).toBe('отвечаю');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);

    const types = events.map((event) => event.type);
    const firstIdle = types.indexOf('idle');
    const secondListen = types.lastIndexOf('listen.end');
    expect(firstIdle).toBeGreaterThanOrEqual(0);
    expect(firstIdle).toBeLessThan(secondListen);
  });

  it('после stop() таймеры остановлены', async () => {
    const created = new Set<unknown>();
    const cleared = new Set<unknown>();
    const realSetInterval = globalThis.setInterval.bind(globalThis) as (
      handler: () => void,
      ms?: number
    ) => unknown;
    const realClearInterval = globalThis.clearInterval.bind(globalThis) as (timer: unknown) => void;
    vi.stubGlobal('setInterval', (handler: () => void, ms?: number) => {
      const timer = realSetInterval(handler, ms);
      created.add(timer);
      return timer;
    });
    vi.stubGlobal('clearInterval', (timer: unknown) => {
      cleared.add(timer);
      realClearInterval(timer);
    });

    const { core } = await setup();
    await core.stop();

    expect(created.size).toBeGreaterThan(0);
    for (const timer of created) {
      expect(cleared.has(timer)).toBe(true);
    }
  });
});
