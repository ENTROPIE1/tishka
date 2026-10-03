import type { ToolDef, ToolRegistry, ToolResult } from '../types';
import type { Scheduler } from './scheduler';

const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

function ok(content: string, data?: unknown): ToolResult {
  return data === undefined ? { ok: true, content } : { ok: true, content, data };
}

function fail(error: string): ToolResult {
  return { ok: false, content: '', error };
}

function resolveTime(time: string, now: Date): string | undefined {
  const match = TIME_PATTERN.exec(time.trim());
  if (match !== null) {
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) {
      return undefined;
    }
    const candidate = new Date(now);
    candidate.setHours(hours, minutes, 0, 0);
    if (candidate.getTime() <= now.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate.toISOString();
  }

  const parsed = Date.parse(time);
  if (Number.isNaN(parsed)) {
    return undefined;
  }
  return new Date(parsed).toISOString();
}

const createReminder: ToolDef = {
  name: 'create_reminder',
  description: 'Создаёт напоминание, которое сработает в указанное время.',
  inputSchema: {
    type: 'object',
    properties: {
      time: { type: 'string', description: 'Время напоминания: момент в формате ISO или ЧЧ:ММ' },
      text: { type: 'string', description: 'Текст напоминания' }
    },
    required: ['time', 'text'],
    additionalProperties: false
  },
  source: 'builtin',
  readOnly: false
};

const listReminders: ToolDef = {
  name: 'list_reminders',
  description: 'Показывает список невыполненных напоминаний.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false
  },
  source: 'builtin',
  readOnly: true
};

const deleteReminder: ToolDef = {
  name: 'delete_reminder',
  description: 'Удаляет напоминание по его идентификатору.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Идентификатор напоминания' }
    },
    required: ['id'],
    additionalProperties: false
  },
  source: 'builtin',
  readOnly: false
};

export function registerTriggerTools(registry: ToolRegistry, scheduler: Scheduler, now: () => Date): void {
  registry.register(createReminder, async (args) => {
    const time = args.time;
    const text = args.text;
    if (typeof time !== 'string' || time.trim() === '') {
      return fail('Поле time должно быть непустой строкой');
    }
    if (typeof text !== 'string' || text.trim() === '') {
      return fail('Поле text должно быть непустой строкой');
    }
    const at = resolveTime(time, now());
    if (at === undefined) {
      return fail('Не удалось разобрать время: укажите ISO или ЧЧ:ММ');
    }
    const reminder = await scheduler.addReminder(at, text);
    return ok(`Напомню: ${reminder.text}`, reminder);
  });

  registry.register(listReminders, async () => {
    const reminders = await scheduler.listReminders();
    if (reminders.length === 0) {
      return ok('Невыполненных напоминаний нет', []);
    }
    const content = reminders.map((reminder) => `${reminder.at} — ${reminder.text}`).join('\n');
    return ok(content, reminders);
  });

  registry.register(deleteReminder, async (args) => {
    const id = args.id;
    if (typeof id !== 'string' || id.trim() === '') {
      return fail('Поле id должно быть непустой строкой');
    }
    await scheduler.removeReminder(id);
    return ok('Удалил напоминание');
  });
}
