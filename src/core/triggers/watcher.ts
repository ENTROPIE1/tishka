import type { EventBus, Skill, ToolResult, ToolRegistry } from '../types';
import { runTriggered } from '../idle';
import type { RunResult } from '../skills/runner';
import { renderTemplate, type TemplateContext } from '../skills/template';
import { skillState, type createTriggerState, type TriggerState } from './state';

const CHECK_INTERVAL_MS = 30_000;
const ERROR_THRESHOLD = 3;
// После (пере)запуска первая проверка — не раньше минуты, чтобы старт приложения
// не дёргал все наблюдения сразу.
const MIN_FIRST_CHECK_MS = 60_000;

type WatchTrigger = Extract<Skill['trigger'], { type: 'watch' }>;

export interface WatcherDeps {
  skills: { list(): Promise<Skill[]> };
  registry: ToolRegistry;
  runner: { run(skill: Skill, inputs?: Record<string, unknown>): Promise<RunResult> };
  state: ReturnType<typeof createTriggerState>;
  events: EventBus;
  now: () => Date;
}

export interface WatchCheckResult {
  changed: boolean;
  value?: string;
  error?: string;
}

export interface Watcher {
  start(): Promise<void>;
  stop(): void;
  tick(): Promise<void>;
  checkNow(skillId: string): Promise<WatchCheckResult>;
}

interface EvalResult extends WatchCheckResult {
  touched: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stringify(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined) {
    return '';
  }
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function defaultInputs(skill: Skill): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  for (const input of skill.inputs ?? []) {
    if (input.default !== undefined) {
      inputs[input.name] = input.default;
    }
  }
  return inputs;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractField(data: unknown, path: string): string | undefined {
  const segments = path.split('.').filter((segment) => segment !== '');
  let current = data;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return undefined;
      }
      current = current[index];
    } else if (isRecord(current)) {
      if (!Object.prototype.hasOwnProperty.call(current, segment)) {
        return undefined;
      }
      current = current[segment];
    } else {
      return undefined;
    }
  }
  if (current === undefined) {
    return undefined;
  }
  return stringify(current);
}

function valueFor(trigger: WatchTrigger, result: ToolResult): { ok: true; value: string } | { ok: false } {
  if (trigger.field !== undefined) {
    const value = extractField(result.data, trigger.field);
    if (value === undefined) {
      return { ok: false };
    }
    return { ok: true, value };
  }
  return { ok: true, value: result.content };
}

export function createWatcher(deps: WatcherDeps): Watcher {
  const createdAt = deps.now().getTime();
  let timer: ReturnType<typeof setInterval> | undefined;

  function renderArgs(skill: Skill, trigger: WatchTrigger): Record<string, unknown> | undefined {
    const ctx: TemplateContext = { inputs: defaultInputs(skill), steps: {}, now: deps.now() };
    const rendered = renderTemplate(trigger.args, ctx);
    if (!isRecord(rendered)) {
      return undefined;
    }
    for (const value of Object.values(rendered)) {
      if (typeof value === 'string' && value === '') {
        return undefined;
      }
    }
    return rendered;
  }

  function countFailure(skill: Skill, state: TriggerState): void {
    const entry = state.watches[skill.id] ?? { errors: 0 };
    entry.errors += 1;
    state.watches[skill.id] = entry;
    if (entry.errors === ERROR_THRESHOLD) {
      deps.events.emit({ type: 'error', message: `Наблюдение не выполнено: ${skill.name}` });
    }
  }

  async function evaluate(skill: Skill, state: TriggerState): Promise<EvalResult> {
    const trigger = skill.trigger;
    if (trigger.type !== 'watch') {
      return { changed: false, touched: false };
    }

    let args: Record<string, unknown> | undefined;
    try {
      args = renderArgs(skill, trigger);
    } catch {
      return { changed: false, touched: false };
    }
    if (args === undefined) {
      return { changed: false, touched: false };
    }

    const result = await deps.registry.call(trigger.tool, args, { background: true });
    if (!result.ok) {
      countFailure(skill, state);
      return { changed: false, error: result.error ?? result.content, touched: true };
    }

    const extracted = valueFor(trigger, result);
    if (!extracted.ok) {
      countFailure(skill, state);
      return { changed: false, error: `В результате нет поля ${trigger.field ?? ''}`, touched: true };
    }

    const value = extracted.value;
    const entry = state.watches[skill.id] ?? { errors: 0 };
    let touched = false;

    if (entry.errors !== 0) {
      entry.errors = 0;
      touched = true;
    }

    if (entry.last === undefined) {
      entry.last = value;
      state.watches[skill.id] = entry;
      return { changed: false, value, touched: true };
    }

    if (entry.last === value) {
      if (touched) {
        state.watches[skill.id] = entry;
      }
      return { changed: false, value, touched };
    }

    const previous = entry.last;
    entry.last = value;
    state.watches[skill.id] = entry;

    await runTriggered(deps.events, async () => {
      deps.events.emit({ type: 'wake', source: 'trigger' });
      const runState = skillState(state, skill.id);
      try {
        const run = await deps.runner.run(skill, { previous, current: value });
        runState.lastRunAt = deps.now().toISOString();
        runState.runCount += 1;
        runState.lastResult = run.ok ? 'ok' : run.error ?? `Навык не выполнен: ${skill.name}`;
        if (run.ok) {
          deps.events.emit({ type: 'notify', title: skill.name, skillId: skill.id });
        } else {
          deps.events.emit({ type: 'error', message: run.error ?? `Навык не выполнен: ${skill.name}` });
        }
      } catch (error) {
        const message = errorMessage(error);
        runState.lastRunAt = deps.now().toISOString();
        runState.runCount += 1;
        runState.lastResult = message;
        deps.events.emit({ type: 'error', message });
      }
    });

    return { changed: true, value, touched: true };
  }

  async function processState(state: TriggerState): Promise<void> {
    const skills = await deps.skills.list();
    const watchSkills = skills.filter((skill) => skill.trigger.type === 'watch');
    const active = new Set(watchSkills.map((skill) => skill.id));
    const nowMs = deps.now().getTime();
    let changed = false;

    for (const id of Object.keys(state.watches)) {
      if (!active.has(id)) {
        delete state.watches[id];
        changed = true;
      }
    }

    for (const skill of watchSkills) {
      if (skill.enabled === false) {
        continue;
      }
      const trigger = skill.trigger as WatchTrigger;
      const intervalMs = trigger.everyMinutes * 60_000;
      const previousStamp = state.watches[skill.id]?.checkedAt;
      const previousAt = previousStamp === undefined ? Number.NaN : Date.parse(previousStamp);
      const hasPrevious = Number.isFinite(previousAt);
      if (hasPrevious && nowMs - previousAt < intervalMs) {
        continue;
      }
      if (hasPrevious && nowMs - createdAt < MIN_FIRST_CHECK_MS) {
        continue;
      }

      const entry = state.watches[skill.id] ?? { errors: 0 };
      entry.checkedAt = deps.now().toISOString();
      state.watches[skill.id] = entry;
      const runState = skillState(state, skill.id);
      runState.lastCheckAt = entry.checkedAt;
      runState.nextAt = new Date(nowMs + intervalMs).toISOString();
      changed = true;

      try {
        const result = await evaluate(skill, state);
        if (result.touched) {
          changed = true;
        }
      } catch (error) {
        deps.events.emit({ type: 'error', message: errorMessage(error) });
      }
    }

    if (changed) {
      await deps.state.save(state);
    }
  }

  async function guardedTick(): Promise<void> {
    try {
      const state = await deps.state.load();
      await processState(state);
    } catch (error) {
      deps.events.emit({ type: 'error', message: errorMessage(error) });
    }
  }

  return {
    async start(): Promise<void> {
      if (timer !== undefined) {
        return;
      }
      await deps.state.exclusive(guardedTick);
      timer = setInterval(() => {
        void deps.state.exclusive(guardedTick);
      }, CHECK_INTERVAL_MS);
    },

    stop(): void {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    },

    tick(): Promise<void> {
      return deps.state.exclusive(guardedTick);
    },

    checkNow(skillId: string): Promise<WatchCheckResult> {
      return deps.state.exclusive(async () => {
        const skills = await deps.skills.list();
        const skill = skills.find((item) => item.id === skillId && item.trigger.type === 'watch');
        if (skill === undefined) {
          return { changed: false, error: `Наблюдение не найдено: ${skillId}` };
        }
        const state = await deps.state.load();
        const entry = state.watches[skillId] ?? { errors: 0 };
        entry.checkedAt = deps.now().toISOString();
        state.watches[skillId] = entry;
        const result = await evaluate(skill, state);
        if (result.touched) {
          await deps.state.save(state);
        }
        return { changed: result.changed, value: result.value, error: result.error };
      });
    }
  };
}
