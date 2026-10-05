import { addDays, addMinutes, atTime, startOfDay, toLocalIso } from './time';

export interface ParsedWhen {
  start: string;
  end?: string;
  durationMinutes?: number;
  allDay: boolean;
}

interface DurationHit {
  minutes: number;
  index: number;
  length: number;
}

const HOUR = '(?:час(?:а|ов)?|ч)';
const MIN = '(?:минут(?:ы|у)?|мин)';

// Кириллица не входит в \b, поэтому границы слова задаются явно.
function word(body: string): RegExp {
  return new RegExp(`(?<![а-я])${body}(?![а-я])`);
}

const DURATION_PATTERNS: { re: RegExp; calc: (match: RegExpExecArray) => number }[] = [
  { re: new RegExp(`(\\d+)\\s*${HOUR}(?:\\s+(\\d+)\\s*${MIN})?`), calc: (m) => Number(m[1]) * 60 + (m[2] === undefined ? 0 : Number(m[2])) },
  { re: new RegExp(`(\\d+)\\s*${MIN}`), calc: (m) => Number(m[1]) },
  { re: /полчаса|пол часа/, calc: () => 30 },
  { re: word('час'), calc: () => 60 }
];

const WEEKDAY_STEMS: { re: RegExp; day: number }[] = [
  { re: /понедельник\w*/, day: 1 },
  { re: /вторник\w*/, day: 2 },
  { re: /сред[ау]?\w*/, day: 3 },
  { re: /четверг\w*/, day: 4 },
  { re: /пятниц[ау]?\w*/, day: 5 },
  { re: /суббот[ау]?\w*/, day: 6 },
  { re: /воскресен\w*/, day: 0 }
];

// Длительность берётся только вплотную за «через» или «на», иначе «через час
// на 30 минут» перепутало бы смещение и длительность.
function leadingDuration(text: string): DurationHit | undefined {
  const lead = /^\s*/.exec(text)?.[0].length ?? 0;
  const trimmed = text.slice(lead);
  for (const pattern of DURATION_PATTERNS) {
    const match = new RegExp(`^(?:${pattern.re.source})`).exec(trimmed);
    if (match !== null) {
      return { minutes: pattern.calc(match), index: lead, length: match[0].length };
    }
  }
  return undefined;
}

function cut(text: string, start: number, length: number): string {
  return text.slice(0, start) + text.slice(start + length);
}

function timeOf(hours: number, minutes: number | undefined): number | undefined {
  if (hours > 23) {
    return undefined;
  }
  const min = minutes === undefined ? 0 : minutes;
  if (min > 59) {
    return undefined;
  }
  return hours * 60 + min;
}

function resolveWeekday(day: number, now: Date): Date {
  const current = now.getDay();
  let ahead = (day - current + 7) % 7;
  if (ahead === 0) {
    ahead = 7;
  }
  return addDays(startOfDay(now), ahead);
}

// Разбирает «завтра в 15», «в пятницу с 10 до 11», «через час на 30 минут».
export function parseWhen(input: string, now: Date): ParsedWhen | undefined {
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(input.trim());
  if (iso) {
    const parsed = Date.parse(input.trim());
    return Number.isNaN(parsed) ? undefined : { start: toLocalIso(new Date(parsed)), allDay: false };
  }

  let text = input.toLowerCase().replace(/ё/g, 'е').replace(/[«»"]/g, ' ').trim();
  if (text === '') {
    return undefined;
  }

  text = text.replace(/весь день|на весь день/g, ' ');

  let relative: number | undefined;
  const through = word('через').exec(text);
  if (through !== null) {
    const rest = text.slice(through.index + through[0].length);
    const duration = leadingDuration(rest);
    if (duration !== undefined) {
      relative = duration.minutes;
      text = text.slice(0, through.index) + rest.slice(0, duration.index) + rest.slice(duration.index + duration.length);
    }
  }

  let durationMinutes: number | undefined;
  const on = word('на').exec(text);
  if (on !== null) {
    const rest = text.slice(on.index + on[0].length);
    const duration = leadingDuration(rest);
    if (duration !== undefined) {
      durationMinutes = duration.minutes;
      text = text.slice(0, on.index) + rest.slice(0, duration.index) + rest.slice(duration.index + duration.length);
    }
  }

  let anchor: Date | undefined;
  const todayMatch = word('сегодня').exec(text);
  const afterTomorrowMatch = word('послезавтра').exec(text);
  const tomorrowMatch = word('завтра').exec(text);
  if (afterTomorrowMatch !== null) {
    anchor = addDays(startOfDay(now), 2);
    text = cut(text, afterTomorrowMatch.index, afterTomorrowMatch[0].length);
  } else if (tomorrowMatch !== null) {
    anchor = addDays(startOfDay(now), 1);
    text = cut(text, tomorrowMatch.index, tomorrowMatch[0].length);
  } else if (todayMatch !== null) {
    anchor = startOfDay(now);
    text = cut(text, todayMatch.index, todayMatch[0].length);
  } else {
    for (const stem of WEEKDAY_STEMS) {
      const match = stem.re.exec(text);
      if (match !== null) {
        anchor = resolveWeekday(stem.day, now);
        text = cut(text, match.index, match[0].length);
        break;
      }
    }
  }

  if (relative !== undefined) {
    const start = addMinutes(now, relative);
    const result: ParsedWhen = { start: toLocalIso(start), allDay: false };
    if (durationMinutes !== undefined) {
      result.durationMinutes = durationMinutes;
      result.end = toLocalIso(addMinutes(start, durationMinutes));
    }
    return result;
  }

  const range = /с\s*(\d{1,2})(?::(\d{2}))?\s*(?:до|по)\s*(\d{1,2})(?::(\d{2}))?/.exec(text);
  if (range !== null) {
    const from = timeOf(Number(range[1]), range[2] === undefined ? undefined : Number(range[2]));
    const to = timeOf(Number(range[3]), range[4] === undefined ? undefined : Number(range[4]));
    if (from === undefined || to === undefined) {
      return undefined;
    }
    const day = anchor ?? startOfDay(now);
    let start = atTime(day, from);
    if (anchor === undefined && start.getTime() <= now.getTime()) {
      start = atTime(addDays(day, 1), from);
    }
    let end = atTime(start, to <= from ? to + 24 * 60 : to);
    return { start: toLocalIso(start), end: toLocalIso(end), allDay: false };
  }

  const single = /(\d{1,2})(?::(\d{2}))?/.exec(text);
  if (single !== null) {
    const minute = timeOf(Number(single[1]), single[2] === undefined ? undefined : Number(single[2]));
    if (minute === undefined) {
      return undefined;
    }
    const day = anchor ?? startOfDay(now);
    let start = atTime(day, minute);
    if (anchor === undefined && start.getTime() <= now.getTime()) {
      start = atTime(addDays(day, 1), minute);
    }
    const result: ParsedWhen = { start: toLocalIso(start), allDay: false };
    if (durationMinutes !== undefined) {
      result.durationMinutes = durationMinutes;
      result.end = toLocalIso(addMinutes(start, durationMinutes));
    }
    return result;
  }

  if (anchor !== undefined) {
    const end = addDays(anchor, 1);
    return { start: toLocalIso(anchor), end: toLocalIso(end), allDay: true };
  }

  return undefined;
}
