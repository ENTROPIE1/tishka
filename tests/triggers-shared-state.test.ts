import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEventBus } from '../src/core/events';
import type { RunResult } from '../src/core/skills/runner';
import { validateSkill } from '../src/core/skills/validate';
import { createToolRegistry } from '../src/core/tools/registry';
import { createScheduler, type SchedulerDeps } from '../src/core/triggers/scheduler';
import { createTriggerState } from '../src/core/triggers/state';
import { createWatcher, type WatcherDeps } from '../src/core/triggers/watcher';
import type { Skill } from '../src/core/types';

const TOOL = 'page_version';

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
    steps: [{ id: 'step', tool: TOOL, args: {} }],
    ...overrides
  });
  if (!result.ok) {
    throw new Error(result.errors.join('; '));
  }
  return result.skill;
}

let dir: string;
const schedulers: ReturnType<typeof createScheduler>[] = [];
const watchers: ReturnType<typeof createWatcher>[] = [];
const states: ReturnType<typeof createTriggerState>[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tishka-shared-'));
});

afterEach(async () => {
  for (const scheduler of schedulers) {
    scheduler.stop();
  }
  for (const watcher of watchers) {
    watcher.stop();
  }
  for (const state of states) {
    await state.exclusive(async () => undefined);
  }
  schedulers.length = 0;
  watchers.length = 0;
  states.length = 0;
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('общее состояние расписания и наблюдений', () => {
  it('изменение наблюдателя и напоминание не теряются во время долгого навыка', async () => {
    const path = join(dir, 'triggers.json');
    const state = createTriggerState(path);
    states.push(state);
    const bus = createEventBus();
    const registry = createToolRegistry(bus);
    registry.register(
      { name: TOOL, description: 'версия', inputSchema: { type: 'object' }, source: 'builtin', readOnly: true },
      async () => ({ ok: true, content: 'one' })
    );

    const scheduleSkill = makeSkill({
      id: 'slow',
      name: 'Долгий',
      trigger: { type: 'schedule', cron: '* * * * *' }
    });
    const watchSkill = makeSkill({
      id: 'watch-skill',
      name: 'Следи',
      trigger: { type: 'watch', tool: TOOL, args: {}, everyMinutes: 1 }
    });

    const now = local(2026, 10, 5, 10, 0);

    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const schedulerDeps: SchedulerDeps = {
      skills: { list: async () => [scheduleSkill, watchSkill] },
      runner: {
        run: async (): Promise<RunResult> => {
          started();
          await gate;
          return { ok: true, steps: {} };
        }
      },
      state,
      events: bus,
      now: () => now
    };
    const watcherDeps: WatcherDeps = {
      skills: { list: async () => [scheduleSkill, watchSkill] },
      registry,
      runner: { run: async (): Promise<RunResult> => ({ ok: true, steps: {} }) },
      state,
      events: bus,
      now: () => now
    };

    const scheduler = createScheduler(schedulerDeps);
    const watcher = createWatcher(watcherDeps);
    schedulers.push(scheduler);
    watchers.push(watcher);

    const ticking = scheduler.tick();
    await startedPromise;

    const watching = watcher.tick();
    const adding = scheduler.addReminder(local(2026, 10, 5, 11, 0).toISOString(), 'Позже');

    release();
    await ticking;
    await watching;
    const reminder = await adding;

    const loaded = await createTriggerState(path).load();
    expect(loaded.watches[watchSkill.id]?.last).toBe('one');
    expect(loaded.reminders.map((item) => item.id)).toContain(reminder.id);
  });
});
