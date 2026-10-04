import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../src/core/config';
import { choice, cleanupCores, replyChoice, setupCore, toolChoice } from './core-helpers';

const delay = (ms: number): Promise<void> =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('Не дождались нужного состояния');
    }
    await delay(25);
  }
}

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await cleanupCores();
});

describe('createTishkaCore', () => {
  it('после start() в пустом каталоге данных появились пресеты, config() даёт значения по умолчанию', async () => {
    const { core, dataDir } = await setupCore();

    const files = await readdir(join(dataDir, 'skills'));

    expect(files).toEqual(expect.arrayContaining(['friday-morning.tishka.json', 'watch-page.tishka.json']));
    expect(core.config()).toEqual(defaultConfig());
    expect(core.mcpStatus()).toEqual([]);
  });

  it('фраза «утро пятницы» запускает пресет: ссылки открыты, модель не вызывалась', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => choice({ content: 'ок' }));
    const { core, openExternal, events } = await setupCore({ fetch: fetchMock });

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
    const { core, events } = await setupCore({ fetch: fetchMock });

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
    const { core, dataDir, events } = await setupCore({ fetch: fetchMock });

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
    vi.stubEnv('DKS_API_KEY', '');
    const fetchMock = vi.fn<typeof fetch>(async () => choice({ content: 'ок' }));
    const { core } = await setupCore({ fetch: fetchMock, secrets: {} });

    const reply = await core.handleUserText('привет');

    expect(reply.mood).toBe('confused');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('без секрета и переменной окружения Тишка просит добавить ключ в подключениях', async () => {
    vi.stubEnv('DKS_API_KEY', '');
    const fetchMock = vi.fn<typeof fetch>(async () => choice({ content: 'ок' }));
    const { core } = await setupCore({ fetch: fetchMock, secrets: {} });

    const reply = await core.handleUserText('привет');

    expect(reply.say).toBe('Ключ шлюза не задан, добавь его в подключениях');
    expect(reply.mood).toBe('confused');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('без секрета, но с переменной окружения DKS_API_KEY ключ берётся из неё', async () => {
    vi.stubEnv('DKS_API_KEY', 'env-key-123');
    let authorization: string | undefined;
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      authorization = (init?.headers as Record<string, string>).Authorization;
      return replyChoice('r1', 'Привет! Я Тишка.');
    });
    const { core } = await setupCore({ fetch: fetchMock, secrets: {} });

    const reply = await core.handleUserText('привет');

    expect(reply.say).toBe('Привет! Я Тишка.');
    expect(authorization).toBe('Bearer env-key-123');
  });

  it('hasGatewayKey: секрет DKS_API_KEY даёт true', async () => {
    const { core } = await setupCore({ secrets: { DKS_API_KEY: 'test-key' } });

    await expect(core.hasGatewayKey()).resolves.toBe(true);
  });

  it('hasGatewayKey: без секрета ключ берётся из переменной окружения', async () => {
    vi.stubEnv('DKS_API_KEY', 'env-key-123');
    const { core } = await setupCore({ secrets: {} });

    await expect(core.hasGatewayKey()).resolves.toBe(true);
  });

  it('hasGatewayKey: без секрета и переменной окружения false', async () => {
    vi.stubEnv('DKS_API_KEY', '');
    const { core } = await setupCore({ secrets: {} });

    await expect(core.hasGatewayKey()).resolves.toBe(false);
  });

  it('сервер MCP с несуществующей командой даёт статус error, остальное работает', async () => {
    const { core } = await setupCore({
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
    const { core, events } = await setupCore({ fetch: fetchMock });

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

  it('после handleUserText в history() есть запись пользователя и запись Тишки', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => replyChoice('r1', 'Привет! Я Тишка.'));
    const { core } = await setupCore({ fetch: fetchMock });

    await core.handleUserText('расскажи о себе');

    const entries = core.history();
    const userIndex = entries.findIndex(
      (entry) => entry.kind === 'message' && entry.from === 'user' && entry.text === 'расскажи о себе'
    );
    const tishkaIndex = entries.findIndex(
      (entry) => entry.kind === 'message' && entry.from === 'tishka' && entry.text === 'Привет! Я Тишка.'
    );
    expect(userIndex).toBeGreaterThanOrEqual(0);
    expect(tishkaIndex).toBeGreaterThan(userIndex);
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

    const { core } = await setupCore();
    await core.stop();

    expect(created.size).toBeGreaterThan(0);
    for (const timer of created) {
      expect(cleared.has(timer)).toBe(true);
    }
  });

  it('новый разговор очищает контекст агента и добавляет разделитель', async () => {
    const bodies: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      bodies.push(String(init?.body));
      return replyChoice(`r${bodies.length}`, 'ок');
    });
    const { core } = await setupCore({ fetch: fetchMock });
    const dividers = (): number => core.history().filter((entry) => entry.kind === 'divider').length;

    await core.handleUserText('первый вопрос');
    const before = dividers();

    core.newConversation();
    await core.handleUserText('второй вопрос');

    expect(dividers()).toBe(before + 1);
    expect(bodies[1]).toContain('второй вопрос');
    expect(bodies[1]).not.toContain('первый вопрос');
  });

  it('после 31 минуты тишины начинается новый разговор, после 10 минут — нет', async () => {
    let current = new Date('2026-10-02T10:00:00');
    const fetchMock = vi.fn<typeof fetch>(async () => replyChoice('r1', 'ок'));
    const { core } = await setupCore({ fetch: fetchMock, now: () => current });
    const dividers = (): number => core.history().filter((entry) => entry.kind === 'divider').length;
    const baseline = dividers();

    await core.handleUserText('раз');
    current = new Date('2026-10-02T10:10:00');
    await core.handleUserText('два');
    expect(dividers()).toBe(baseline);

    current = new Date('2026-10-02T10:41:00');
    await core.handleUserText('три');
    expect(dividers()).toBe(baseline + 1);
  });

  it('напоминание Тишки разговор не начинает и не продлевает', async () => {
    let current = new Date('2026-10-02T10:00:00');
    const fetchMock = vi.fn<typeof fetch>(async () => replyChoice('r1', 'ок'));
    const { core, bus } = await setupCore({ fetch: fetchMock, now: () => current });
    const dividers = (): number => core.history().filter((entry) => entry.kind === 'divider').length;
    const baseline = dividers();

    current = new Date('2026-10-02T10:31:00');
    bus.emit({ type: 'notify', title: 'выпить воды' });
    bus.emit({ type: 'reply', reply: { say: 'выпить воды' } });
    expect(dividers()).toBe(baseline);

    current = new Date('2026-10-02T10:32:00');
    await core.handleUserText('привет');
    expect(dividers()).toBe(baseline + 1);
  });

  it('skills.overview отдаёт навыки с описанием и состоянием', async () => {
    const { core } = await setupCore();

    const entries = await core.skills.overview();
    const watch = entries.find((entry) => entry.skill.id === 'watch-page');

    expect(entries.length).toBeGreaterThan(0);
    expect(watch?.description.kind).toBe('watch');
    expect(watch?.description.when).toContain('каждые');
    expect(watch?.state.runCount).toBe(0);
  });

  it('skills.setEnabled выключает навык, экспорт не содержит состояния запусков', async () => {
    const { core, dataDir } = await setupCore();

    await expect(core.skills.setEnabled('watch-page', false)).resolves.toBe(true);
    const off = (await core.skills.overview()).find((entry) => entry.skill.id === 'watch-page');
    expect(off?.skill.enabled).toBe(false);

    const target = join(dataDir, 'watch-page.export.json');
    await core.skills.export('watch-page', target);
    const exported = JSON.parse(await readFile(target, 'utf8')) as Record<string, unknown>;

    expect(exported).not.toHaveProperty('runCount');
    expect(exported).not.toHaveProperty('lastRunAt');
    expect(exported).not.toHaveProperty('nextAt');
    expect(exported).not.toHaveProperty('state');
  });

  it('skills.save отвергает неверный навык со списком ошибок', async () => {
    const { core } = await setupCore();

    const result = await core.skills.save({ format: 'tishka-skill/1', id: 'bad id!', name: '' } as never);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join(' ')).toContain('id');
    }
  });

  it('длинное сообщение человека сокращено в контексте и полно в истории', async () => {
    const bodies: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      bodies.push(String(init?.body));
      return replyChoice(`r${bodies.length}`, 'ок');
    });
    const { core } = await setupCore({ fetch: fetchMock });
    const long = 'я'.repeat(5000);

    await core.handleUserText(long);
    await core.handleUserText('следующий');

    const stored = core
      .history()
      .find((entry) => entry.kind === 'message' && entry.from === 'user' && entry.text.startsWith('я'));
    expect(stored?.kind === 'message' ? stored.text.length : 0).toBe(5000);
    expect(bodies[1]).not.toContain(long);
    expect(bodies[1]).toContain('длинный текст сокращён');
  });
});
