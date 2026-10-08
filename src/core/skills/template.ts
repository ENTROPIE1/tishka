export interface TemplateStepResult {
  content: string;
  data?: unknown;
}

export interface TemplateContext {
  inputs: Record<string, unknown>;
  steps: Record<string, TemplateStepResult>;
  now: Date;
}

const SUBSTITUTION = /\{\{([^}]*)\}\}/g;

function unknownSubstitution(expression: string): Error {
  return new Error(`Неизвестная подстановка: {{${expression}}}`);
}

function navigate(value: unknown, segments: string[], expression: string): unknown {
  let current = value;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        throw unknownSubstitution(expression);
      }
      current = current[index];
    } else if (typeof current === 'object' && current !== null) {
      if (!Object.prototype.hasOwnProperty.call(current, segment)) {
        throw unknownSubstitution(expression);
      }
      current = (current as Record<string, unknown>)[segment];
    } else {
      throw unknownSubstitution(expression);
    }
  }
  return current;
}

const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6
};

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

// Ближайший такой день недели, включая сегодня, пока не наступил вечерний час 17.
function nextWeekdayIso(now: Date, name: string): string {
  const weekday = WEEKDAY_INDEX[name.trim().toLowerCase()];
  if (weekday === undefined) {
    throw unknownSubstitution(`next.${name}`);
  }
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let add = (weekday - day.getDay() + 7) % 7;
  if (add === 0 && (now.getHours() > 17 || (now.getHours() === 17 && now.getMinutes() > 0))) {
    add = 7;
  }
  day.setDate(day.getDate() + add);
  return `${day.getFullYear()}-${pad2(day.getMonth() + 1)}-${pad2(day.getDate())}`;
}

function resolve(expression: string, ctx: TemplateContext): unknown {
  if (expression === 'now') {
    return ctx.now.toISOString();
  }
  if (expression === 'today') {
    return ctx.now.toISOString().slice(0, 10);
  }
  if (expression.startsWith('next.')) {
    return nextWeekdayIso(ctx.now, expression.slice(5));
  }

  const parts = expression.split('.');
  const root = parts[0];

  if (root === 'inputs') {
    const name = parts[1];
    if (name === undefined || name === '' || !Object.prototype.hasOwnProperty.call(ctx.inputs, name)) {
      throw unknownSubstitution(expression);
    }
    return navigate(ctx.inputs[name], parts.slice(2), expression);
  }

  if (root === 'steps') {
    const id = parts[1];
    const rest = parts.slice(2);
    if (
      id === undefined ||
      id === '' ||
      rest.length === 0 ||
      !Object.prototype.hasOwnProperty.call(ctx.steps, id)
    ) {
      throw unknownSubstitution(expression);
    }
    return navigate(ctx.steps[id], rest, expression);
  }

  throw unknownSubstitution(expression);
}

function toText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function renderString(value: string, ctx: TemplateContext): unknown {
  const matches = [...value.matchAll(SUBSTITUTION)];
  if (matches.length === 0) {
    return value;
  }
  if (matches.length === 1 && value.trim() === matches[0][0]) {
    return resolve(matches[0][1].trim(), ctx);
  }
  return value.replace(SUBSTITUTION, (_match: string, expression: string) =>
    toText(resolve(expression.trim(), ctx))
  );
}

export function renderTemplate(value: unknown, ctx: TemplateContext): unknown {
  if (typeof value === 'string') {
    return renderString(value, ctx);
  }
  if (Array.isArray(value)) {
    return value.map((item) => renderTemplate(item, ctx));
  }
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = renderTemplate(item, ctx);
    }
    return result;
  }
  return value;
}
