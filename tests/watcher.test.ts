import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEventBus } from '../src/core/events';
import type { RunResult } from '../src/core/skills/runner';
import { validateSkill } from '../src/core/skills/validate';
import { createToolRegistry } from '../src/core/tools/registry';
import { createTriggerState, emptyTriggerState } from '../src/core/triggers/state';
import { createWatcher, type Watcher, type WatcherDeps } from '../src/core/triggers/watcher';
import type { Skill, TishkaEvent, ToolResult } from '../src/core/types';

const TOOL = 'page_version';

function local(...parts: [number, number, number, number, number]): Date {
  const [year, month, day, hours, minutes] = parts;
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

function makeSkill(overrides: Record<string, unknown> = {}): Skill {
  const result = validateSkill({
    format: 'tishka-skill/1',
    id: 'watch-skill',
    name: 'Следи',
    description: '',
    phrases: [],
    trigger: { type: 'watch', tool: TOOL, args: {}, everyMinutes: 1 },
    steps: [{ id: 'say', say: 'готово' }],
    ...overrides
  });
  if (!result.ok) {
    throw new Error(result.errors.join('; '));
  }
  return result.skill;
}

interface Harness {
  watcher: Watcher;
  events: TishkaEvent[];
  bus: ReturnType<typeof createEventBus>;
  runs: { skill: Skill; inputs?: Record<string, unknown> }[];
  calls: Record<string, unknown>[];
  path: string;
  setNow(date: Date): void;
  spawnWatcher(): Watcher;
}

let dir: string;
const watchers: Watcher[] = [];
const states: ReturnType<typeof createTriggerState>[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tishka-watcher-'));
});

afterEach(async () => {
  for (const watcher of watchers) {
    watcher.stop();
  }
  for (const state of states) {
    await state.exclusive(async () => undefined);
  }
  watchers.length = 0;
  states.length = 0;
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

function setup(options: {
  skills?: Skill[] | (() => Skill[]);
  results?: ToolResult[] | (() => ToolResult);
  startNow?: Date;
  run?: (skill: Skill, inputs?: Record<string, unknown>) => Promise<RunResult>;
}): Harness {
  const path = join(dir, 'triggers.json');
  const state = createTriggerState(path);
  states.push(state);
  const bus = createEventBus();
  const events: TishkaEvent[] = [];
  bus.on((event) => events.push(event));
  const registry = createToolRegistry(bus);
  const calls: Record<string, unknown>[] = [];
  const runs: { skill: Skill; inputs?: Record<string, unknown> }[] = [];

  let current = options.startNow ?? local(2026, 10, 5, 9, 0);
  const skillsSource = options.skills ?? [];
  const resultsSource: ToolResult[] | (() => ToolResult) = options.results ?? [{ ok: true, content: 'one' }];
  let resultIndex = 0;
  function nextResult(): ToolResult {
    if (typeof resultsSource === 'function') {
      return resultsSource();
    }
    const index = Math.min(resultIndex, resultsSource.length - 1);
    resultIndex += 1;
    return resultsSource[index];
  }

  registry.register(
    { name: TOOL, description: 'версия', inputSchema: { type: 'object' }, source: 'builtin', readOnly: true },
    async (args) => {
      calls.push(args);
      return nextResult();
    }
  );

  const run = options.run ?? (async (): Promise<RunResult> => ({ ok: true, steps: {} }));

  const deps: WatcherDeps = {
    skills: {
      list: async () => (typeof skillsSource === 'function' ? skillsSource() : skillsSource)
    },
    registry,
    runner: {
      run: async (skill, inputs) => {
        runs.push({ skill, inputs });
        return run(skill, inputs);
      }
    },
    state,
    events: bus,
    now: () => current
  };

  const watcher = createWatcher(deps);
  watchers.push(watcher);

  return {
    watcher,
    events,
    bus,
    runs,
    calls,
    path,
    setNow: (date) => {
      current = date;
    },
    spawnWatcher: () => {
      const spawned = createWatcher(deps);
      watchers.push(spawned);
      return spawned;
    }
  };
}

describe('createWatcher', () => {
  it('первая проверка запоминает значение и не запускает навык', async () => {
    const skill = makeSkill();
    const h = setup({ skills: [skill], results: [{ ok: true, content: 'one' }] });

    await h.watcher.tick();

    expect(h.runs).toHaveLength(0);
    const state = await createTriggerState(h.path).load();
    expect(state.watches[skill.id]?.last).toBe('one');
    expect(h.events.filter((event) => event.type === 'wake' || event.type === 'notify')).toEqual([]);
  });

  it('значение не изменилось — навык не запускается', async () => {
    const skill = makeSkill();
    const h = setup({ skills: [skill], results: [{ ok: true, content: 'same' }] });

    await h.watcher.tick();
    h.setNow(local(2026, 10, 5, 9, 1));
    await h.watcher.tick();

    expect(h.calls).toHaveLength(2);
    expect(h.runs).toHaveLength(0);
  });

  it('значение изменилось — запуск с previous/current и события wake, notify', async () => {
    const skill = makeSkill();
    const h = setup({ skills: [skill], results: [{ ok: true, content: 'one' }, { ok: true, content: 'two' }] });

    await h.watcher.tick();
    h.setNow(local(2026, 10, 5, 9, 1));
    await h.watcher.tick();

    expect(h.runs).toHaveLength(1);
    expect(h.runs[0].inputs).toEqual({ previous: 'one', current: 'two' });
    expect(h.events).toContainEqual({ type: 'wake', source: 'trigger' });
    expect(h.events).toContainEqual({ type: 'notify', title: 'Следи', skillId: 'watch-skill' });
  });

  it('field берёт поле из data по пути через точку, без field сравнивается content', async () => {
    const fielded = makeSkill({
      id: 'fielded',
      trigger: { type: 'watch', tool: TOOL, args: {}, everyMinutes: 1, field: 'items.0.id' }
    });
    const h = setup({
      skills: [fielded],
      results: [
        { ok: true, content: 'одинаковый', data: { items: [{ id: 'a' }] } },
        { ok: true, content: 'одинаковый', data: { items: [{ id: 'b' }] } }
      ]
    });

    await h.watcher.tick();
    h.setNow(local(2026, 10, 5, 9, 1));
    await h.watcher.tick();

    expect(h.runs).toHaveLength(1);
    expect(h.runs[0].inputs).toEqual({ previous: 'a', current: 'b' });
  });

  it('проверка не чаще everyMinutes: три tick за одну минуту — один вызов инструмента', async () => {
    const skill = makeSkill({ trigger: { type: 'watch', tool: TOOL, args: {}, everyMinutes: 5 } });
    const h = setup({ skills: [skill], results: [{ ok: true, content: 'one' }] });

    await h.watcher.tick();
    await h.watcher.tick();
    await h.watcher.tick();

    expect(h.calls).toHaveLength(1);
  });

  it('три сбоя подряд дают одно событие error, четвёртый — новое не даёт, успех обнуляет', async () => {
    const skill = makeSkill();
    let mode: 'fail' | 'ok' = 'fail';
    const h = setup({
      skills: [skill],
      results: () => (mode === 'fail' ? { ok: false, content: '', error: 'нет' } : { ok: true, content: 'v' })
    });

    await h.watcher.tick();
    h.setNow(local(2026, 10, 5, 9, 1));
    await h.watcher.tick();
    h.setNow(local(2026, 10, 5, 9, 2));
    await h.watcher.tick();
    expect(h.events.filter((event) => event.type === 'error')).toHaveLength(1);

    h.setNow(local(2026, 10, 5, 9, 3));
    await h.watcher.tick();
    expect(h.events.filter((event) => event.type === 'error')).toHaveLength(1);

    mode = 'ok';
    h.setNow(local(2026, 10, 5, 9, 4));
    await h.watcher.tick();

    mode = 'fail';
    for (const minute of [5, 6, 7]) {
      h.setNow(local(2026, 10, 5, 9, minute));
      await h.watcher.tick();
    }
    expect(h.events.filter((event) => event.type === 'error')).toHaveLength(2);
  });

  it('состояние переживает перезапуск: новый наблюдатель не срабатывает на прежнем значении', async () => {
    const skill = makeSkill();
    const h = setup({ skills: [skill], results: () => ({ ok: true, content: 'steady' }) });

    await h.watcher.tick();

    const restarted = h.spawnWatcher();
    await restarted.tick();

    expect(h.runs).toHaveLength(0);
  });

  it('наблюдение с пустым входом пропускается без ошибки', async () => {
    const skill = makeSkill({
      id: 'empty',
      inputs: [{ name: 'page_id', description: 'Страница', required: true, default: '' }],
      trigger: { type: 'watch', tool: TOOL, args: { page_id: '{{inputs.page_id}}' }, everyMinutes: 1 }
    });
    const h = setup({ skills: [skill], results: [{ ok: true, content: 'one' }] });

    await h.watcher.tick();

    expect(h.calls).toHaveLength(0);
    expect(h.events).toEqual([]);
  });

  it('удалённый навык убирается из состояния на следующей проверке', async () => {
    const skill = makeSkill();
    let available: Skill[] = [skill];
    const h = setup({ skills: () => available, results: () => ({ ok: true, content: 'one' }) });

    await h.watcher.tick();
    available = [];
    await h.watcher.tick();

    const state = await createTriggerState(h.path).load();
    expect(state.watches[skill.id]).toBeUndefined();
  });

  it('checkNow возвращает значение и признак изменения', async () => {
    const skill = makeSkill();
    const h = setup({ skills: [skill], results: [{ ok: true, content: 'one' }, { ok: true, content: 'two' }] });

    await expect(h.watcher.checkNow(skill.id)).resolves.toEqual({ changed: false, value: 'one', error: undefined });
    await expect(h.watcher.checkNow(skill.id)).resolves.toEqual({ changed: true, value: 'two', error: undefined });
  });

  it('сбой одного наблюдения не мешает остальным', async () => {
    const failing = makeSkill({ id: 'failing', trigger: { type: 'watch', tool: 'missing_tool', args: {}, everyMinutes: 1 } });
    const working = makeSkill({ id: 'working' });
    const h = setup({ skills: [failing, working], results: [{ ok: true, content: 'one' }] });

    await h.watcher.tick();
    h.setNow(local(2026, 10, 5, 9, 1));
    await h.watcher.tick();

    const state = await createTriggerState(h.path).load();
    expect(state.watches.working?.last).toBe('one');
    expect(state.watches.failing?.errors).toBe(2);
  });
});

describe('createWatcher — таймер', () => {
  it('ошибка проверки по таймеру даёт событие error и не останавливает работу', async () => {
    vi.useFakeTimers();
    try {
      const skill = makeSkill();
      const bus = createEventBus();
      const events: TishkaEvent[] = [];
      bus.on((event) => events.push(event));
      const calls: Record<string, unknown>[] = [];
      const registry = createToolRegistry(bus);
      registry.register(
        { name: TOOL, description: 'версия', inputSchema: { type: 'object' }, source: 'builtin', readOnly: true },
        async (args) => {
          calls.push(args);
          return { ok: true, content: 'one' };
        }
      );
      let fail = true;
      const memory = emptyTriggerState();
      const memoryState = {
        load: async () => memory,
        save: async () => undefined,
        exclusive: async <T>(task: () => Promise<T>): Promise<T> => task()
      };
      states.push(memoryState);
      const watcher = createWatcher({
        skills: {
          list: async () => {
            if (fail) {
              fail = false;
              throw new Error('нет списка');
            }
            return [skill];
          }
        },
        registry,
        runner: { run: async (): Promise<RunResult> => ({ ok: true, steps: {} }) },
        state: memoryState,
        events: bus,
        now: () => local(2026, 10, 5, 9, 0)
      });
      watchers.push(watcher);

      await watcher.start();
      expect(events).toContainEqual({ type: 'error', message: 'нет списка' });

      await vi.advanceTimersByTimeAsync(30_000);
      expect(calls).toHaveLength(1);

      watcher.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('пресет watch-page', () => {
  it('проходит validateSkill', () => {
    const raw = readFileSync(new URL('../presets/watch-page.tishka.json', import.meta.url), 'utf8');
    const result = validateSkill(JSON.parse(raw) as unknown, ['confluence__get_page_version']);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.skill.id).toBe('watch-page');
      expect(result.skill.trigger).toEqual({
        type: 'watch',
        tool: 'confluence__get_page_version',
        args: { page_id: '{{inputs.page_id}}' },
        everyMinutes: 2,
        field: 'version'
      });
    }
  });
});
