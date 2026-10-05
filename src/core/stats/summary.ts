import type { Deed, StatsPeriod, StatsSummary } from '../types';

export const RECENT_LIMIT = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

function atMs(deed: Deed): number {
  const value = Date.parse(deed.at);
  return Number.isFinite(value) ? value : Number.NaN;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

// Понедельник текущей недели: getDay() даёт 0 для воскресенья.
function startOfWeek(date: Date): number {
  const weekday = (date.getDay() + 6) % 7;
  return startOfDay(date) - weekday * DAY_MS;
}

function periodSince(deeds: Deed[], fromMs: number): StatsPeriod {
  let count = 0;
  let minutes = 0;
  for (const deed of deeds) {
    const ms = atMs(deed);
    if (Number.isFinite(ms) && ms >= fromMs) {
      count += 1;
      minutes += deed.minutes;
    }
  }
  return { deeds: count, minutes };
}

function bySkill(deeds: Deed[]): StatsSummary['bySkill'] {
  const groups = new Map<string, { skillId: string; name: string; deeds: number; minutes: number }>();
  for (const deed of deeds) {
    if (deed.skillId === undefined) {
      continue;
    }
    const entry = groups.get(deed.skillId) ?? { skillId: deed.skillId, name: deed.title, deeds: 0, minutes: 0 };
    entry.deeds += 1;
    entry.minutes += deed.minutes;
    groups.set(deed.skillId, entry);
  }
  return [...groups.values()].sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
}

function byWeekday(deeds: Deed[], weekStart: number): StatsPeriod[] {
  const days: StatsPeriod[] = [];
  for (let index = 0; index < 7; index += 1) {
    days.push({ deeds: 0, minutes: 0 });
  }
  for (const deed of deeds) {
    const ms = atMs(deed);
    if (!Number.isFinite(ms) || ms < weekStart) {
      continue;
    }
    const index = Math.floor((startOfDay(new Date(ms)) - weekStart) / DAY_MS);
    if (index >= 0 && index < 7) {
      days[index].deeds += 1;
      days[index].minutes += deed.minutes;
    }
  }
  return days;
}

export function summarize(deeds: Deed[], now: Date): StatsSummary {
  const dayStart = startOfDay(now);
  const weekStart = startOfWeek(now);
  const recent = [...deeds].sort((a, b) => atMs(b) - atMs(a)).slice(0, RECENT_LIMIT);
  return {
    today: periodSince(deeds, dayStart),
    week: periodSince(deeds, weekStart),
    total: { deeds: deeds.length, minutes: deeds.reduce((sum, deed) => sum + deed.minutes, 0) },
    bySkill: bySkill(deeds),
    byWeekday: byWeekday(deeds, weekStart),
    recent
  };
}
