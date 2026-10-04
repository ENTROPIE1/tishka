import type { SkillRunState } from '../../../core/triggers/state';
import type { SkillDescription } from '../../../core/skills/describe';

const KIND_ICON: Record<SkillDescription['kind'], string> = {
  schedule: '◷',
  watch: '◎',
  phrase: '❞'
};

const KIND_TITLE: Record<SkillDescription['kind'], string> = {
  schedule: 'По расписанию',
  watch: 'Наблюдение',
  phrase: 'По фразе'
};

export function kindIcon(kind: SkillDescription['kind']): string {
  return KIND_ICON[kind];
}

export function kindTitle(kind: SkillDescription['kind']): string {
  return KIND_TITLE[kind];
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

function clock(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

function momentText(iso: string, now: Date): string | undefined {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) {
    return undefined;
  }
  const diff = now.getTime() - at.getTime();
  const abs = Math.abs(diff);
  if (abs < 60_000) {
    return 'только что';
  }
  const minutes = Math.round(abs / 60_000);
  if (minutes < 60) {
    return diff >= 0
      ? `${minutes} ${plural(minutes, 'минуту', 'минуты', 'минут')} назад`
      : `через ${minutes} ${plural(minutes, 'минуту', 'минуты', 'минут')}`;
  }
  if (sameDay(at, now)) {
    return diff >= 0 ? `сегодня в ${clock(at)}` : `сегодня в ${clock(at)}`;
  }
  return `${at.toLocaleDateString('ru-RU')} в ${clock(at)}`;
}

export function lastCheckText(state: SkillRunState, now: Date): string | undefined {
  return state.lastCheckAt === undefined ? undefined : momentText(state.lastCheckAt, now);
}

export function nextText(state: SkillRunState, now: Date): string | undefined {
  return state.nextAt === undefined ? undefined : momentText(state.nextAt, now);
}

export function runSummary(state: SkillRunState, now: Date): string {
  if (state.runCount === 0) {
    return 'ещё не срабатывал';
  }
  const last = state.lastRunAt === undefined ? '' : momentText(state.lastRunAt, now);
  const tail = last === undefined || last === '' ? '' : `, последний — ${last}`;
  return `сработал ${state.runCount} ${plural(state.runCount, 'раз', 'раза', 'раз')}${tail}`;
}
