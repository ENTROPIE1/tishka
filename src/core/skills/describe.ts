import type { Skill, Step, ToolDef } from '../types';

export interface SkillDescription {
  title: string;
  summary: string;
  when: string;
  does: string[];
  needs: string[];
  inputs: string[];
  kind: 'phrase' | 'schedule' | 'watch';
}

const SERVER_NAMES: Record<string, string> = {
  confluence: 'Confluence',
  exchange: 'Exchange',
  jira: 'Jira'
};

const WEEKDAY_PLURAL = [
  'воскресеньям',
  'понедельникам',
  'вторникам',
  'средам',
  'четвергам',
  'пятницам',
  'субботам'
];

function firstSentence(text: string): string {
  const trimmed = text.trim();
  const match = /^[^.!?]+[.!?]?/.exec(trimmed);
  return (match?.[0] ?? trimmed).trim();
}

function isInteger(text: string): boolean {
  return /^\d+$/.test(text);
}

function timeText(hours: number, minutes: number): string {
  return `${hours}:${String(minutes).padStart(2, '0')}`;
}

function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return one;
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return few;
  }
  return many;
}

function dayOfWeekText(rawDay: string): string | undefined {
  if (rawDay === '*') {
    return undefined;
  }
  if (rawDay === '1-5') {
    return 'по будням';
  }
  const days = new Set<number>();
  for (const part of rawDay.split(',')) {
    if (isInteger(part)) {
      days.add(Number(part) % 7);
      continue;
    }
    const range = part.split('-');
    if (range.length === 2 && isInteger(range[0]) && isInteger(range[1])) {
      for (let value = Number(range[0]); value <= Number(range[1]); value += 1) {
        days.add(value % 7);
      }
      continue;
    }
    return undefined;
  }
  const names = [...days].sort((a, b) => a - b).map((day) => WEEKDAY_PLURAL[day]);
  return names.length === 0 ? undefined : `по ${names.join(', ')}`;
}

// Расписание в слова для частых случаев; непонятное выражение показываем как есть.
export function cronWords(expr: string): string {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    return expr;
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;

  if (minute === '*' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'каждую минуту';
  }
  if (minute.startsWith('*/') && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const step = Number(minute.slice(2));
    if (isInteger(minute.slice(2)) && step >= 1) {
      return `каждые ${step} ${plural(step, 'минуту', 'минуты', 'минут')}`;
    }
  }
  if (hour.startsWith('*/') && isInteger(minute) && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    const step = Number(hour.slice(2));
    if (isInteger(hour.slice(2)) && step >= 1) {
      return `каждые ${step} ${plural(step, 'час', 'часа', 'часов')}`;
    }
  }

  if (!isInteger(minute) || !isInteger(hour) || dayOfMonth !== '*' || month !== '*') {
    return expr;
  }
  const at = timeText(Number(hour), Number(minute));
  const days = dayOfWeekText(dayOfWeek);
  if (days === undefined) {
    return `каждый день в ${at}`;
  }
  return `${days} в ${at}`;
}

function toolLabel(tool: string, tools: ToolDef[]): string {
  const def = tools.find((item) => item.name === tool);
  if (def !== undefined && def.description.trim() !== '') {
    return firstSentence(def.description);
  }
  return `Вызывает ${tool}`;
}

function describeStep(step: Step, tools: ToolDef[]): string {
  if ('tool' in step) {
    return toolLabel(step.tool, tools);
  }
  if ('ask' in step) {
    return `Просит модель: ${step.ask.slice(0, 60)}…`;
  }
  return `Говорит: ${step.say}`;
}

function phraseWhen(phrases: string[]): string {
  if (phrases.length === 0) {
    return 'По просьбе';
  }
  return `По фразе: ${phrases.map((phrase) => `“${phrase}”`).join(', ')}`;
}

function scheduleWhen(skill: Skill): string {
  const trigger = skill.trigger;
  if (trigger.type !== 'schedule') {
    return '';
  }
  if (trigger.at !== undefined) {
    return `По расписанию: ${trigger.at}`;
  }
  const cron = trigger.cron ?? '';
  return `По расписанию: ${cronWords(cron)}`;
}

function watchWhen(skill: Skill): string {
  const trigger = skill.trigger;
  if (trigger.type !== 'watch') {
    return '';
  }
  const minutes = trigger.everyMinutes;
  const every = minutes === 1 ? 'каждую минуту' : `каждые ${minutes} ${plural(minutes, 'минуту', 'минуты', 'минут')}`;
  return `Наблюдение: ${every} проверяет ${trigger.tool}`;
}

function whenText(skill: Skill): string {
  if (skill.trigger.type === 'schedule') {
    return scheduleWhen(skill);
  }
  if (skill.trigger.type === 'watch') {
    return watchWhen(skill);
  }
  return phraseWhen(skill.phrases);
}

export function describeSkill(skill: Skill, tools: ToolDef[] = []): SkillDescription {
  return {
    title: skill.name,
    summary: skill.description,
    when: whenText(skill),
    does: skill.steps.map((step) => describeStep(step, tools)),
    needs: (skill.requires ?? []).map((name) => SERVER_NAMES[name] ?? name.charAt(0).toUpperCase() + name.slice(1)),
    inputs: (skill.inputs ?? []).map((input) => (input.description !== '' ? input.description : input.name)),
    kind: skill.trigger.type === 'manual' ? 'phrase' : skill.trigger.type
  };
}
