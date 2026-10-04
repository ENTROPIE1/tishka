import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEventBus } from '../src/core/events';
import { createSkillRunner, type RunResult } from '../src/core/skills/runner';
import { validateSkill } from '../src/core/skills/validate';
import { createToolRegistry } from '../src/core/tools/registry';
import { createScheduler, type SchedulerDeps } from '../src/core/triggers/scheduler';
import { createTriggerState, type TriggerState } from '../src/core/triggers/state';
import { registerTriggerTools } from '../src/core/triggers/tools';
import type { Skill, TishkaEvent } from '../src/core/types';

function local(...parts: [number, number, number, number, number]): Date {
  const [year, month, day, hours, minutes] = parts;
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

function makeSkill(overrides: Record<string, unknown> = {}): Skill {
  const result = validateSkill({
    format: 'tishka-skill/1',
    id: 'test-skill',
    name: 'Тестовый навык',
    description: '',
    phrases: [],
    trigger: { type: 'manual' },
    steps: [{ id: 'step', tool: 'noop', args: {} }],
    ...overrides
  });
  if (!result.ok) {
    throw new Error(result.errors.join('; '));
  }
  return result.skill;
}

interface Harness {
  scheduler: ReturnType<typeof createScheduler>;
  events: TishkaEvent[];
  bus: ReturnType<typeof createEventBus>;
  runs: Skill[];
  path: string;
  setNow(date: Date): void;
}

let dir: string;
const schedulers: ReturnType<typeof createScheduler>[] = [];
const states: ReturnType<typeof createTriggerState>[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tishka-triggers-'));
});

afterEach(async () => {
  for (const scheduler of schedulers) {
    scheduler.stop();
  }
  for (const state of states) {
    await state.exclusive(async () => undefined);
  }
  schedulers.length = 0;
  states.length = 0;
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

function setup(options: {
  skills?: Skill[] | (() => Skill[]);
  run?: (skill: Skill) => Promise<RunResult>;
  startNow?: Date;
}): Harness {
  const path = join(dir, 'triggers.json');
  const state = createTriggerState(path);
  states.push(state);
  const bus = createEventBus();
  const events: TishkaEvent[] = [];
  bus.on((event) => events.push(event));
  const runs: Skill[] = [];
  let current = options.startNow ?? local(2026, 10, 5, 9, 0);
  const skillsSource = options.skills ?? [];
  const run =
    options.run ??
    (async (): Promise<RunResult> => ({ ok: true, steps: {} }));

  const deps: SchedulerDeps = {
    skills: {
      list: async () => (typeof skillsSource === 'function' ? skillsSource() : skillsSource)
    },
    runner: {
      run: async (skill) => {
        runs.push(skill);
        return run(skill);
      }
    },
    state,
    events: bus,
    now: () => current
  };

  const scheduler = createScheduler(deps);
  schedulers.push(scheduler);

  return {
    scheduler,
    events,
    bus,
    runs,
    path,
    setNow: (date) => {
      current = date;
    }
  };
}

describe('createScheduler — напоминания', () => {
  it('не срабатывает раньше времени, срабатывает один раз и шлёт wake, notify, reply', async () => {
    const h = setup({ startNow: local(2026, 10, 5, 9, 0) });
    await h.scheduler.addReminder(local(2026, 10, 5, 9, 5).toISOString(), 'Купить хлеб');

    await h.scheduler.tick();
    expect(h.events).toEqual([]);

    h.setNow(local(2026, 10, 5, 9, 5));
    await h.scheduler.tick();
    expect(h.events).toEqual([
      { type: 'wake', source: 'trigger' },
      { type: 'notify', title: 'Купить хлеб' },
      { type: 'reply', reply: { say: 'Купить хлеб' } }
    ]);

    await h.scheduler.tick();
    expect(h.events).toHaveLength(3);
  });

  it('состояние переживает перезапуск приложения', async () => {
    const h = setup({ startNow: local(2026, 10, 5, 9, 0) });
    await h.scheduler.addReminder(local(2026, 10, 5, 12, 0).toISOString(), 'Позвонить маме');

    const restartedState = createTriggerState(h.path);
    states.push(restartedState);
    const restarted = createScheduler({
      skills: { list: async () => [] },
      runner: { run: async (): Promise<RunResult> => ({ ok: true, steps: {} }) },
      state: restartedState,
      events: h.bus,
      now: () => local(2026, 10, 5, 9, 0)
    });
    schedulers.push(restarted);

    const reminders = await restarted.listReminders();
    expect(reminders).toHaveLength(1);
    expect(reminders[0].text).toBe('Позвонить маме');
  });

  it('пропущенное на 1 час срабатывает при start(), пропущенное на 20 часов — нет', async () => {
    const soon = setup({ startNow: local(2026, 10, 5, 9, 0) });
    await soon.scheduler.addReminder(local(2026, 10, 5, 8, 0).toISOString(), 'Свежее');
    await soon.scheduler.start();
    soon.scheduler.stop();
    expect(soon.events).toContainEqual({ type: 'reply', reply: { say: 'Свежее' } });

    const old = setup({ startNow: local(2026, 10, 6, 4, 0) });
    await old.scheduler.addReminder(local(2026, 10, 5, 8, 0).toISOString(), 'Старое');
    await old.scheduler.start();
    old.scheduler.stop();
    expect(old.events).toEqual([]);
    expect(await old.scheduler.listReminders()).toEqual([]);
  });
});

describe('createScheduler — навыки', () => {
  it('навык по cron за одну минуту запускается один раз даже при трёх проверках', async () => {
    const skill = makeSkill({ id: 'minute', name: 'Минутный', trigger: { type: 'schedule', cron: '* * * * *' } });
    const h = setup({ skills: [skill], startNow: local(2026, 10, 5, 10, 0) });

    await h.scheduler.tick();
    await h.scheduler.tick();
    await h.scheduler.tick();

    expect(h.runs).toHaveLength(1);
  });

  it('выключенный навык не запускается по расписанию', async () => {
    const skill = makeSkill({
      id: 'off',
      name: 'Выключенный',
      enabled: false,
      trigger: { type: 'schedule', cron: '* * * * *' }
    });
    const h = setup({ skills: [skill], startNow: local(2026, 10, 5, 10, 0) });

    await h.scheduler.tick();
    h.setNow(local(2026, 10, 5, 10, 1));
    await h.scheduler.tick();

    expect(h.runs).toHaveLength(0);
  });

  it('разовый навык после срабатывания не запускается снова', async () => {
    const skill = makeSkill({
      id: 'once',
      name: 'Разовый',
      trigger: { type: 'schedule', at: local(2026, 10, 5, 8, 0).toISOString() }
    });
    const h = setup({ skills: [skill], startNow: local(2026, 10, 5, 9, 0) });

    await h.scheduler.tick();
    await h.scheduler.tick();

    expect(h.runs).toHaveLength(1);
    expect(h.events).toContainEqual({ type: 'wake', source: 'trigger' });
    expect(h.events).toContainEqual({ type: 'notify', title: 'Разовый', skillId: 'once' });
  });

  it('разовый навык старше 12 часов помечается выполненным без запуска', async () => {
    const skill = makeSkill({
      id: 'stale',
      name: 'Просроченный',
      trigger: { type: 'schedule', at: local(2026, 10, 5, 8, 0).toISOString() }
    });
    const h = setup({ skills: [skill], startNow: local(2026, 10, 6, 4, 0) });

    await h.scheduler.start();
    h.scheduler.stop();

    expect(h.runs).toHaveLength(0);
    expect(h.events).not.toContainEqual({ type: 'notify', title: 'Просроченный', skillId: 'stale' });
  });

  it('сбой навыка даёт событие error, следующая проверка работает', async () => {
    const skill = makeSkill({ id: 'flaky', name: 'Сбойный', trigger: { type: 'schedule', cron: '* * * * *' } });
    let attempt = 0;
    const h = setup({
      skills: [skill],
      startNow: local(2026, 10, 5, 10, 0),
      run: async (): Promise<RunResult> => {
        attempt += 1;
        return attempt === 1 ? { ok: false, error: 'сломалось', steps: {} } : { ok: true, steps: {} };
      }
    });

    await h.scheduler.tick();
    expect(h.events).toContainEqual({ type: 'error', message: 'сломалось' });

    h.setNow(local(2026, 10, 5, 10, 1));
    await h.scheduler.tick();

    expect(h.runs).toHaveLength(2);
    expect(h.events).toContainEqual({ type: 'notify', title: 'Сбойный', skillId: 'flaky' });
  });

  it('напоминание, добавленное во время долгого навыка, не теряется', async () => {
    const skill = makeSkill({ id: 'slow', name: 'Долгий', trigger: { type: 'schedule', cron: '* * * * *' } });
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const h = setup({
      skills: [skill],
      startNow: local(2026, 10, 5, 10, 0),
      run: async (): Promise<RunResult> => {
        started();
        await gate;
        return { ok: true, steps: {} };
      }
    });

    const ticking = h.scheduler.tick();
    await startedPromise;
    const adding = h.scheduler.addReminder(local(2026, 10, 5, 11, 0).toISOString(), 'Позже');
    release();
    await ticking;
    const reminder = await adding;

    const loaded = await createTriggerState(h.path).load();
    expect(loaded.reminders.map((item) => item.id)).toContain(reminder.id);
  });

  it('ошибка проверки по таймеру даёт событие error и не останавливает проверку', async () => {
    vi.useFakeTimers();
    try {
      const skill = makeSkill({ id: 'cron', name: 'Крон', trigger: { type: 'schedule', cron: '* * * * *' } });
      const bus = createEventBus();
      const events: TishkaEvent[] = [];
      bus.on((event) => events.push(event));
      const runs: Skill[] = [];
      let fail = true;
      const memory: TriggerState = { reminders: [], firedOnce: [], watches: {} };
      const memoryState = {
        load: async () => memory,
        save: async () => undefined,
        exclusive: async <T>(task: () => Promise<T>): Promise<T> => task()
      };
      states.push(memoryState);
      const scheduler = createScheduler({
        skills: {
          list: async () => {
            if (fail) {
              fail = false;
              throw new Error('нет списка');
            }
            return [skill];
          }
        },
        runner: {
          run: async () => {
            runs.push(skill);
            return { ok: true, steps: {} };
          }
        },
        state: memoryState,
        events: bus,
        now: () => local(2026, 10, 5, 10, 0)
      });
      schedulers.push(scheduler);

      await scheduler.start();
      expect(events).toContainEqual({ type: 'error', message: 'нет списка' });
      expect(runs).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(20_000);
      expect(runs).toHaveLength(1);

      scheduler.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('список навыков перечитывается на каждой проверке', async () => {
    let available: Skill[] = [];
    const skill = makeSkill({ id: 'late', name: 'Поздний', trigger: { type: 'schedule', cron: '* * * * *' } });
    const h = setup({ skills: () => available, startNow: local(2026, 10, 5, 10, 0) });

    await h.scheduler.tick();
    available = [skill];
    await h.scheduler.tick();

    expect(h.runs).toHaveLength(1);
  });

  it('реальный навык выполняется через runner и даёт notify', async () => {
    const skill = makeSkill({ id: 'real', name: 'Настоящий', trigger: { type: 'schedule', cron: '* * * * *' } });
    const bus = createEventBus();
    const events: TishkaEvent[] = [];
    bus.on((event) => events.push(event));
    const registry = createToolRegistry(bus);
    registry.register(
      { name: 'noop', description: 'noop', inputSchema: { type: 'object' }, source: 'builtin', readOnly: true },
      async () => ({ ok: true, content: 'ок' })
    );
    const runner = createSkillRunner({ registry, ask: vi.fn(), events: bus, now: () => local(2026, 10, 5, 10, 0) });
    const realState = createTriggerState(join(dir, 'triggers.json'));
    states.push(realState);
    const scheduler = createScheduler({
      skills: { list: async () => [skill] },
      runner,
      state: realState,
      events: bus,
      now: () => local(2026, 10, 5, 10, 0)
    });
    schedulers.push(scheduler);

    await scheduler.tick();

    expect(events).toContainEqual({ type: 'notify', title: 'Настоящий', skillId: 'real' });
  });
});

describe('registerTriggerTools', () => {
  it('create_reminder с ЧЧ:ММ в прошлом создаёт напоминание на завтра', async () => {
    const now = local(2026, 10, 5, 12, 0);
    const h = setup({ startNow: now });
    const registry = createToolRegistry(h.bus);
    registerTriggerTools(registry, h.scheduler, () => now);

    const result = await registry.call('create_reminder', { time: '09:00', text: 'Зарядка' });

    expect(result.ok).toBe(true);
    const reminders = await h.scheduler.listReminders();
    expect(reminders).toHaveLength(1);
    expect(reminders[0].at).toBe(local(2026, 10, 6, 9, 0).toISOString());
    expect(reminders[0].text).toBe('Зарядка');
  });

  it('create_reminder принимает ISO, list_reminders и delete_reminder работают', async () => {
    const now = local(2026, 10, 5, 12, 0);
    const h = setup({ startNow: now });
    const registry = createToolRegistry(h.bus);
    registerTriggerTools(registry, h.scheduler, () => now);

    const created = await registry.call('create_reminder', {
      time: local(2026, 10, 5, 18, 0).toISOString(),
      text: 'Встреча'
    });
    expect(created.ok).toBe(true);
    const reminder = created.data as { id: string };

    const listed = await registry.call('list_reminders', {});
    expect(listed.ok).toBe(true);
    expect(listed.content).toContain('Встреча');

    const removed = await registry.call('delete_reminder', { id: reminder.id });
    expect(removed.ok).toBe(true);
    expect(await h.scheduler.listReminders()).toEqual([]);
  });

  it('create_reminder с неразборчивым временем возвращает ошибку', async () => {
    const now = local(2026, 10, 5, 12, 0);
    const h = setup({ startNow: now });
    const registry = createToolRegistry(h.bus);
    registerTriggerTools(registry, h.scheduler, () => now);

    const result = await registry.call('create_reminder', { time: 'когда-нибудь', text: 'Дело' });

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});
