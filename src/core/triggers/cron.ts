export interface CronSpec {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
}

interface FieldSpec {
  name: string;
  min: number;
  max: number;
}

const FIELDS: FieldSpec[] = [
  { name: 'минута', min: 0, max: 59 },
  { name: 'час', min: 0, max: 23 },
  { name: 'день месяца', min: 1, max: 31 },
  { name: 'месяц', min: 1, max: 12 },
  { name: 'день недели', min: 0, max: 7 }
];

function parseNumber(text: string, field: FieldSpec): number {
  if (!/^\d+$/.test(text)) {
    throw new Error(`Некорректное значение поля «${field.name}»: ${text}`);
  }
  const value = Number(text);
  if (value < field.min || value > field.max) {
    throw new Error(`Значение поля «${field.name}» вне диапазона ${field.min}-${field.max}: ${text}`);
  }
  return value;
}

function parseField(raw: string, field: FieldSpec): number[] {
  const values = new Set<number>();
  const parts = raw.split(',');
  if (parts.length === 0 || (parts.length === 1 && parts[0] === '')) {
    throw new Error(`Пустое поле «${field.name}»`);
  }

  for (const part of parts) {
    if (part === '') {
      throw new Error(`Пустое значение в поле «${field.name}»`);
    }
    if (part === '*') {
      for (let value = field.min; value <= field.max; value += 1) {
        values.add(value);
      }
      continue;
    }
    if (part.startsWith('*/')) {
      const step = parseNumber(part.slice(2), field);
      if (step < 1) {
        throw new Error(`Шаг поля «${field.name}» должен быть не меньше 1`);
      }
      for (let value = field.min; value <= field.max; value += step) {
        values.add(value);
      }
      continue;
    }
    if (part.includes('-')) {
      const bounds = part.split('-');
      if (bounds.length !== 2) {
        throw new Error(`Некорректный диапазон в поле «${field.name}»: ${part}`);
      }
      const from = parseNumber(bounds[0], field);
      const to = parseNumber(bounds[1], field);
      if (from > to) {
        throw new Error(`Границы диапазона поля «${field.name}» идут по убыванию: ${part}`);
      }
      for (let value = from; value <= to; value += 1) {
        values.add(value);
      }
      continue;
    }
    values.add(parseNumber(part, field));
  }

  return [...values].sort((a, b) => a - b);
}

export function parseCron(expr: string): CronSpec {
  if (typeof expr !== 'string' || expr.trim() === '') {
    throw new Error('Выражение cron не должно быть пустым');
  }
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error('Выражение cron должно состоять из пяти полей: минута час день месяц день-недели');
  }

  const parsed = fields.map((field, index) => parseField(field, FIELDS[index]));
  const dayOfWeek = [...new Set(parsed[4].map((value) => value % 7))].sort((a, b) => a - b);

  return {
    minute: parsed[0],
    hour: parsed[1],
    dayOfMonth: parsed[2],
    month: parsed[3],
    dayOfWeek
  };
}

export function cronMatches(spec: CronSpec, date: Date): boolean {
  return (
    spec.minute.includes(date.getMinutes()) &&
    spec.hour.includes(date.getHours()) &&
    spec.dayOfMonth.includes(date.getDate()) &&
    spec.month.includes(date.getMonth() + 1) &&
    spec.dayOfWeek.includes(date.getDay())
  );
}

const MAX_SEARCH_MINUTES = 366 * 24 * 60;

// Ближайший момент после from, подходящий под выражение. Ограничение поиска
// годом защищает от выражений без будущих срабатываний.
export function nextCronOccurrence(spec: CronSpec, from: Date): Date | undefined {
  const candidate = new Date(from);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);
  for (let step = 0; step < MAX_SEARCH_MINUTES; step += 1) {
    if (cronMatches(spec, candidate)) {
      return new Date(candidate);
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  return undefined;
}
