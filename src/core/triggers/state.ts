import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface Reminder {
  id: string;
  at: string;
  text: string;
  done: boolean;
}

export interface WatchState {
  last?: string;
  errors: number;
  checkedAt?: string;            // ISO последней фоновой проверки
}

export interface SkillRunState {
  lastRunAt?: string;            // ISO последнего запуска навыка
  lastResult?: string;           // 'ok' или текст ошибки
  lastCheckAt?: string;          // ISO последней фоновой проверки
  nextAt?: string;               // ISO следующей проверки или запуска
  runCount: number;              // число срабатываний
}

export interface TriggerState {
  reminders: Reminder[];
  firedOnce: string[];
  watches: Record<string, WatchState>;
  skills?: Record<string, SkillRunState>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function emptyTriggerState(): TriggerState {
  return { reminders: [], firedOnce: [], watches: {} };
}

function parseState(raw: unknown): TriggerState {
  if (!isRecord(raw)) {
    return emptyTriggerState();
  }

  const state = emptyTriggerState();

  if (Array.isArray(raw.reminders)) {
    for (const item of raw.reminders) {
      if (
        isRecord(item) &&
        typeof item.id === 'string' &&
        typeof item.at === 'string' &&
        typeof item.text === 'string'
      ) {
        state.reminders.push({ id: item.id, at: item.at, text: item.text, done: item.done === true });
      }
    }
  }

  if (Array.isArray(raw.firedOnce)) {
    state.firedOnce = raw.firedOnce.filter((value): value is string => typeof value === 'string');
  }

  if (isRecord(raw.watches)) {
    for (const [key, value] of Object.entries(raw.watches)) {
      if (!isRecord(value)) {
        continue;
      }
      const entry: WatchState = {
        errors: typeof value.errors === 'number' && Number.isFinite(value.errors) ? value.errors : 0
      };
      if (typeof value.last === 'string') {
        entry.last = value.last;
      }
      if (typeof value.checkedAt === 'string') {
        entry.checkedAt = value.checkedAt;
      }
      state.watches[key] = entry;
    }
  }

  if (isRecord(raw.skills)) {
    const skills: Record<string, SkillRunState> = {};
    for (const [key, value] of Object.entries(raw.skills)) {
      if (!isRecord(value)) {
        continue;
      }
      const entry: SkillRunState = {
        runCount: typeof value.runCount === 'number' && Number.isFinite(value.runCount) ? value.runCount : 0
      };
      if (typeof value.lastRunAt === 'string') {
        entry.lastRunAt = value.lastRunAt;
      }
      if (typeof value.lastResult === 'string') {
        entry.lastResult = value.lastResult;
      }
      if (typeof value.lastCheckAt === 'string') {
        entry.lastCheckAt = value.lastCheckAt;
      }
      if (typeof value.nextAt === 'string') {
        entry.nextAt = value.nextAt;
      }
      skills[key] = entry;
    }
    state.skills = skills;
  }

  return state;
}

export function skillState(state: TriggerState, id: string): SkillRunState {
  if (state.skills === undefined) {
    state.skills = {};
  }
  const existing = state.skills[id];
  if (existing !== undefined) {
    return existing;
  }
  const created: SkillRunState = { runCount: 0 };
  state.skills[id] = created;
  return created;
}

export function createTriggerState(filePath: string): {
  load(): Promise<TriggerState>;
  save(state: TriggerState): Promise<void>;
  exclusive<T>(task: () => Promise<T>): Promise<T>;
} {
  let chain: Promise<unknown> = Promise.resolve();

  function exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = chain.then(task);
    chain = result.catch(() => undefined);
    return result;
  }

  return {
    exclusive,

    async load(): Promise<TriggerState> {
      let raw: string;
      try {
        raw = await readFile(filePath, 'utf8');
      } catch {
        return emptyTriggerState();
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return emptyTriggerState();
      }
      return parseState(parsed);
    },

    async save(state: TriggerState): Promise<void> {
      await mkdir(dirname(filePath), { recursive: true });
      const temporary = `${filePath}.tmp`;
      await writeFile(temporary, JSON.stringify(state, null, 2), 'utf8');
      await rename(temporary, filePath);
    }
  };
}
