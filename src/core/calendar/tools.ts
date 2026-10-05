import type { Panel, ToolDef, ToolRegistry, ToolResult } from '../types';
import { eventSubtitle, eventTimeLabel, resolveRange } from './format';
import { parseWhen, type ParsedWhen } from './parse';
import { situation, situationLine } from './situation';
import type { CalendarStore } from './store';
import type {
  AddEventInput,
  CalendarConfig,
  CalendarEvent,
  CalendarKind,
  CalendarRange,
  UpdateEventPatch
} from './types';
import { toLocalIso } from './time';
import { freeWindows } from './windows';

const KINDS: CalendarKind[] = ['meeting', 'focus', 'personal', 'reminder', 'away'];

export interface CalendarToolDeps {
  store: CalendarStore;
  provider: () => Promise<CalendarEvent[]>;
  config: () => CalendarConfig;
  now: () => Date;
  emitChanged?: () => void;
}

function ok(content: string, data?: unknown, reply?: ToolResult['reply']): ToolResult {
  const result: ToolResult = { ok: true, content };
  if (data !== undefined) {
    result.data = data;
  }
  if (reply !== undefined) {
    result.reply = reply;
  }
  return result;
}

function fail(error: string): ToolResult {
  return { ok: false, content: '', error };
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseInput(value: string, now: Date): ParsedWhen | undefined {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    const start = new Date(`${value.trim()}T00:00:00`);
    const end = new Date(start.getTime() + 86_400_000);
    return { start: toLocalIso(start), end: toLocalIso(end), allDay: true };
  }
  return parseWhen(value, now);
}

function overlaps(events: CalendarEvent[], start: string, end: string, excludeId?: string): CalendarEvent[] {
  const from = Date.parse(start);
  const to = Date.parse(end);
  if (Number.isNaN(from) || Number.isNaN(to)) {
    return [];
  }
  return events.filter((event) => {
    if (event.id === excludeId || event.kind === 'reminder') {
      return false;
    }
    const s = Date.parse(event.start);
    const e = Date.parse(event.end);
    return !Number.isNaN(s) && !Number.isNaN(e) && s < to && e > from;
  });
}

function rangeFrom(args: Record<string, unknown>, now: Date): CalendarRange | undefined {
  const from = str(args.from);
  const to = str(args.to);
  if (from !== undefined && to !== undefined) {
    return { from, to };
  }
  return resolveRange(str(args.period), now);
}

function agendaPanel(range: CalendarRange, events: CalendarEvent[]): Panel {
  const title = range.from === undefined ? 'Календарь' : `Календарь: ${range.from.slice(0, 10)}`;
  return {
    kind: 'list',
    title,
    items: events.map((event) => ({ title: `${eventTimeLabel(event)} — ${event.title}`, subtitle: eventSubtitle(event) }))
  };
}

const agendaTool: ToolDef = {
  name: 'calendar_agenda',
  description: 'Показывает события календаря за период: сегодня, завтра, неделю или указанные даты.',
  inputSchema: {
    type: 'object',
    properties: {
      period: { type: 'string', description: 'today, tomorrow, week или даты ГГГГ-ММ-ДД' },
      from: { type: 'string', description: 'Начало периода, ISO' },
      to: { type: 'string', description: 'Конец периода, ISO' }
    },
    additionalProperties: false
  },
  source: 'builtin',
  readOnly: true
};

const addTool: ToolDef = {
  name: 'calendar_add',
  description: 'Заводит событие в календаре. Время можно задать словами: «завтра в 15», «в пятницу с 10 до 11», «через час на 30 минут».',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Название события' },
      when: { type: 'string', description: 'Начало словами или с концом/длительностью' },
      start: { type: 'string', description: 'Начало: ISO или словами' },
      end: { type: 'string', description: 'Конец' },
      durationMinutes: { type: 'number', description: 'Длительность в минутах' },
      allDay: { type: 'boolean', description: 'Событие на весь день' },
      kind: { type: 'string', enum: KINDS, description: 'Вид события' },
      remindMinutes: { type: ['number', 'null'], description: 'За сколько минут напомнить, null — не напоминать' },
      location: { type: 'string' },
      link: { type: 'string' },
      note: { type: 'string' }
    },
    required: ['title'],
    additionalProperties: false
  },
  source: 'builtin',
  readOnly: false
};

const updateTool: ToolDef = {
  name: 'calendar_update',
  description: 'Изменяет своё событие календаря. У загруженных событий меняются только напоминание и заметка.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      start: { type: 'string' },
      end: { type: 'string' },
      allDay: { type: 'boolean' },
      kind: { type: 'string', enum: KINDS },
      remindMinutes: { type: ['number', 'null'] },
      location: { type: 'string' },
      link: { type: 'string' },
      note: { type: 'string' }
    },
    required: ['id'],
    additionalProperties: false
  },
  source: 'builtin',
  readOnly: false
};

const removeTool: ToolDef = {
  name: 'calendar_remove',
  description: 'Удаляет своё событие календаря по идентификатору.',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
    additionalProperties: false
  },
  source: 'builtin',
  readOnly: false
};

const freeTool: ToolDef = {
  name: 'calendar_free',
  description: 'Показывает свободные окна в рабочее время дня.',
  inputSchema: {
    type: 'object',
    properties: {
      day: { type: 'string', description: 'День, ISO или ГГГГ-ММ-ДД, по умолчанию сегодня' },
      durationMinutes: { type: 'number', description: 'Нужная длительность окна, по умолчанию 30' }
    },
    additionalProperties: false
  },
  source: 'builtin',
  readOnly: true
};

const statusTool: ToolDef = {
  name: 'calendar_status',
  description: 'Сообщает обстановку в календаре сейчас: рабочее ли время, что идёт, что дальше, свободен ли человек.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  source: 'builtin',
  readOnly: true
};

async function addEvent(args: Record<string, unknown>, deps: CalendarToolDeps): Promise<ToolResult> {
  const title = str(args.title);
  if (title === undefined) {
    return Promise.resolve(fail('Поле title должно быть непустой строкой'));
  }
  const now = deps.now();
  const source = str(args.when) ?? str(args.start);
  if (source === undefined) {
    return Promise.resolve(fail('Укажите начало: поле when или start'));
  }
  const parsed = parseInput(source, now);
  if (parsed === undefined) {
    return Promise.resolve(fail('Не удалось разобрать время события'));
  }
  const allDay = args.allDay === true || parsed.allDay;
  let start = parsed.start;
  let end = parsed.end;
  const explicitEnd = str(args.end);
  const duration = num(args.durationMinutes) ?? parsed.durationMinutes;
  if (explicitEnd !== undefined) {
    const endParsed = parseInput(explicitEnd, now);
    if (endParsed === undefined) {
      return Promise.resolve(fail('Не удалось разобрать конец события'));
    }
    end = endParsed.start;
  } else if (end === undefined) {
    end = toLocalIso(new Date(Date.parse(start) + (duration ?? 60) * 60_000));
  }
  if (allDay && !parsed.allDay) {
    const base = new Date(start);
    base.setHours(0, 0, 0, 0);
    start = toLocalIso(base);
    end = toLocalIso(new Date(base.getTime() + 86_400_000));
  }
  const kind = typeof args.kind === 'string' && (KINDS as string[]).includes(args.kind) ? (args.kind as CalendarKind) : 'meeting';
  const remind = args.remindMinutes === null ? null : num(args.remindMinutes) ?? deps.config().defaultRemindMinutes;

  const input: AddEventInput = { title, start, end, allDay, kind, remindMinutes: remind };
  const location = str(args.location);
  const link = str(args.link);
  const note = str(args.note);
  if (location !== undefined) {
    input.location = location;
  }
  if (link !== undefined) {
    input.link = link;
  }
  if (note !== undefined) {
    input.note = note;
  }

  const clashing = overlaps(await deps.provider(), start, end);
  const event = await deps.store.add(input);
  deps.emitChanged?.();
  const tail = clashing.length === 0 ? '' : ` Пересекается с: ${clashing.map((item) => `«${item.title}»`).join(', ')}.`;
  return ok(`Создал событие «${title}» на ${eventTimeLabel(event)}.${tail}`, event);
}

function updateEvent(args: Record<string, unknown>, deps: CalendarToolDeps): Promise<ToolResult> {
  const id = str(args.id);
  if (id === undefined) {
    return Promise.resolve(fail('Поле id должно быть непустой строкой'));
  }
  if (id.startsWith('schedule:')) {
    return Promise.resolve(fail('Событие расписания только для чтения'));
  }
  const patch: UpdateEventPatch = {};
  const title = str(args.title);
  const start = str(args.start);
  const end = str(args.end);
  const location = str(args.location);
  const link = str(args.link);
  const note = str(args.note);
  if (title !== undefined) {
    patch.title = title;
  }
  if (start !== undefined) {
    patch.start = start;
  }
  if (end !== undefined) {
    patch.end = end;
  }
  if (location !== undefined) {
    patch.location = location;
  }
  if (link !== undefined) {
    patch.link = link;
  }
  if (note !== undefined) {
    patch.note = note;
  }
  if (typeof args.allDay === 'boolean') {
    patch.allDay = args.allDay;
  }
  if (typeof args.kind === 'string' && (KINDS as string[]).includes(args.kind)) {
    patch.kind = args.kind as CalendarKind;
  }
  if (args.remindMinutes === null) {
    patch.remindMinutes = null;
  } else if (num(args.remindMinutes) !== undefined) {
    patch.remindMinutes = num(args.remindMinutes);
  }
  return deps.store.update(id, patch).then((event) => {
    if (event === undefined) {
      return fail('Событие не найдено или его нельзя править');
    }
    deps.emitChanged?.();
    return ok(`Изменил событие «${event.title}»`, event);
  });
}

export function registerCalendarTools(registry: ToolRegistry, deps: CalendarToolDeps): void {
  registry.register(agendaTool, async (args) => {
    const range = rangeFrom(args, deps.now());
    if (range === undefined) {
      return fail('Не удалось определить период');
    }
    const list = await deps.provider();
    const from = range.from === undefined ? -Infinity : Date.parse(range.from);
    const to = range.to === undefined ? Infinity : Date.parse(range.to);
    const events = list
      .filter((event) => {
        const s = Date.parse(event.start);
        const e = Date.parse(event.end);
        return !Number.isNaN(s) && !Number.isNaN(e) && s < to && e > from;
      })
      .sort((a, b) => a.start.localeCompare(b.start));
    if (events.length === 0) {
      return ok('Событий за период нет', [], { say: 'На этот период событий нет', show: agendaPanel(range, []) });
    }
    const content = events.map((event) => `${eventTimeLabel(event)} — ${event.title} (${eventSubtitle(event)})`).join('\n');
    return ok(content, events, { say: `Событий: ${events.length}`, show: agendaPanel(range, events) });
  });

  registry.register(addTool, (args) => addEvent(args, deps));

  registry.register(updateTool, (args) => updateEvent(args, deps));

  registry.register(removeTool, async (args) => {
    const id = str(args.id);
    if (id === undefined) {
      return fail('Поле id должно быть непустой строкой');
    }
    if (id.startsWith('schedule:')) {
      return fail('Событие расписания только для чтения');
    }
    const removed = await deps.store.remove(id);
    if (!removed) {
      return fail('Событие не найдено или его нельзя удалить');
    }
    deps.emitChanged?.();
    return ok('Удалил событие');
  });

  registry.register(freeTool, async (args) => {
    const now = deps.now();
    const dayArg = str(args.day);
    const parsedDay = dayArg === undefined ? { start: toLocalIso(now), allDay: false } : parseInput(dayArg, now);
    if (parsedDay === undefined) {
      return fail('Не удалось разобрать день');
    }
    const duration = num(args.durationMinutes) ?? 30;
    const windows = freeWindows(await deps.provider(), deps.config(), new Date(parsedDay.start), duration);
    if (windows.length === 0) {
      return ok('Свободных окон нет', [], { say: 'Свободного времени не нашёл' });
    }
    const content = windows.map((w) => `${eventClock(w.start)}–${eventClock(w.end)}`).join(', ');
    return ok(content, windows);
  });

  registry.register(statusTool, async () => {
    const now = deps.now();
    const state = situation(await deps.provider(), deps.config(), now);
    const line = situationLine(state, now);
    return ok(line, state, { say: line });
  });
}

function eventClock(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
