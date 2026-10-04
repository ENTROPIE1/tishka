import { randomUUID } from 'node:crypto';
import type { EventBus, Skill } from '../types';
import type { RunResult, SkillRunOptions } from '../skills/runner';
import { cronMatches, nextCronOccurrence, parseCron, type CronSpec } from './cron';
import { skillState, type createTriggerState, type Reminder, type TriggerState } from './state';

const MISSED_LIMIT_MS = 12 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 20_000;

export interface SchedulerDeps {
  skills: { list(): Promise<Skill[]> };
  runner: { run(skill: Skill, inputs?: Record<string, unknown>, opts?: SkillRunOptions): Promise<RunResult> };
  state: ReturnType<typeof createTriggerState>;
  events: EventBus;
  now: () => Date;
}

export interface Scheduler {
  start(): Promise<void>;
  stop(): void;
  tick(): Promise<void>;
  addReminder(at: string, text: string): Promise<Reminder>;
  listReminders(): Promise<Reminder[]>;
  removeReminder(id: string): Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function minuteStamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function minuteKey(skillId: string, date: Date): string {
  return `${skillId}@${minuteStamp(date)}`;
}

export function createScheduler(deps: SchedulerDeps): Scheduler {
  let timer: ReturnType<typeof setInterval> | undefined;
  const firedMinutes = new Set<string>();

  function emitReminder(reminder: Reminder): void {
    deps.events.emit({ type: 'wake', source: 'trigger' });
    deps.events.emit({ type: 'notify', title: reminder.text });
    deps.events.emit({ type: 'reply', reply: { say: reminder.text } });
  }

  function setNext(state: TriggerState, id: string, value: string | undefined): boolean {
    if (value === undefined) {
      return false;
    }
    const runState = skillState(state, id);
    if (runState.nextAt === value) {
      return false;
    }
    runState.nextAt = value;
    return true;
  }

  async function runSkill(skill: Skill, state: TriggerState): Promise<void> {
    deps.events.emit({ type: 'wake', source: 'trigger' });
    const runState = skillState(state, skill.id);
    runState.lastRunAt = deps.now().toISOString();
    runState.runCount += 1;
    try {
      const result = await deps.runner.run(skill, undefined, { background: true });
      runState.lastResult = result.ok ? 'ok' : result.error ?? `Навык не выполнен: ${skill.name}`;
      if (result.ok) {
        deps.events.emit({ type: 'notify', title: skill.name, skillId: skill.id });
      } else {
        deps.events.emit({ type: 'error', message: result.error ?? `Навык не выполнен: ${skill.name}` });
      }
    } catch (error) {
      const message = errorMessage(error);
      runState.lastResult = message;
      deps.events.emit({ type: 'error', message });
    }
  }

  async function processState(state: TriggerState): Promise<void> {
    const now = deps.now();
    const nowMs = now.getTime();
    let changed = false;

    const stamp = minuteStamp(now);
    for (const key of firedMinutes) {
      if (!key.endsWith(`@${stamp}`)) {
        firedMinutes.delete(key);
      }
    }

    for (const reminder of state.reminders) {
      if (reminder.done) {
        continue;
      }
      const at = Date.parse(reminder.at);
      if (Number.isNaN(at) || nowMs < at) {
        continue;
      }
      if (nowMs - at > MISSED_LIMIT_MS) {
        reminder.done = true;
        changed = true;
        continue;
      }
      emitReminder(reminder);
      reminder.done = true;
      changed = true;
    }

    const skills = await deps.skills.list();
    for (const skill of skills) {
      if (skill.trigger.type !== 'schedule' || skill.enabled === false) {
        continue;
      }

      if (skill.trigger.at !== undefined) {
        if (state.firedOnce.includes(skill.id)) {
          continue;
        }
        const at = Date.parse(skill.trigger.at);
        if (Number.isNaN(at)) {
          state.firedOnce.push(skill.id);
          changed = true;
          deps.events.emit({
            type: 'error',
            message: `Навык ${skill.name}: не разбирается время запуска «${skill.trigger.at}»`
          });
          continue;
        }
        if (nowMs < at) {
          if (setNext(state, skill.id, skill.trigger.at)) {
            changed = true;
          }
          continue;
        }
        state.firedOnce.push(skill.id);
        changed = true;
        if (nowMs - at > MISSED_LIMIT_MS) {
          continue;
        }
        await runSkill(skill, state);
        continue;
      }

      const cron = skill.trigger.cron;
      if (cron === undefined) {
        continue;
      }

      let spec: CronSpec;
      try {
        spec = parseCron(cron);
      } catch (error) {
        deps.events.emit({ type: 'error', message: `Навык ${skill.name}: ${errorMessage(error)}` });
        continue;
      }

      const next = nextCronOccurrence(spec, now);
      if (setNext(state, skill.id, next?.toISOString())) {
        changed = true;
      }

      if (!cronMatches(spec, now)) {
        continue;
      }
      const key = minuteKey(skill.id, now);
      if (firedMinutes.has(key)) {
        continue;
      }
      firedMinutes.add(key);
      await runSkill(skill, state);
      changed = true;
    }

    if (changed) {
      await deps.state.save(state);
    }
  }

  async function check(): Promise<void> {
    const state = await deps.state.load();
    await processState(state);
  }

  async function guardedCheck(): Promise<void> {
    try {
      await check();
    } catch (error) {
      deps.events.emit({ type: 'error', message: errorMessage(error) });
    }
  }

  return {
    async start(): Promise<void> {
      if (timer !== undefined) {
        return;
      }
      await deps.state.exclusive(guardedCheck);
      timer = setInterval(() => {
        void deps.state.exclusive(guardedCheck);
      }, CHECK_INTERVAL_MS);
    },

    stop(): void {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    },

    tick(): Promise<void> {
      return deps.state.exclusive(() => check());
    },

    addReminder(at: string, text: string): Promise<Reminder> {
      return deps.state.exclusive(async () => {
        const state = await deps.state.load();
        const reminder: Reminder = { id: randomUUID(), at, text, done: false };
        state.reminders.push(reminder);
        await deps.state.save(state);
        return reminder;
      });
    },

    listReminders(): Promise<Reminder[]> {
      return deps.state.exclusive(async () => {
        const state = await deps.state.load();
        return state.reminders
          .filter((reminder) => !reminder.done)
          .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
      });
    },

    removeReminder(id: string): Promise<void> {
      return deps.state.exclusive(async () => {
        const state = await deps.state.load();
        state.reminders = state.reminders.filter((reminder) => reminder.id !== id);
        await deps.state.save(state);
      });
    }
  };
}
