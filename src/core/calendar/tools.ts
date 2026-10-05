import type { ToolRegistry, ToolResult } from '../types';
import { eventSubtitle, eventTimeLabel } from './format';
import { situation, situationLine } from './situation';
import { addEvent, updateEvent } from './tool-actions';
import { addTool, agendaTool, freeTool, removeTool, statusTool, syncTool, updateTool } from './tool-defs';
import {
  agendaPanel,
  eventClock,
  fail,
  num,
  ok,
  parseInput,
  rangeFrom,
  str,
  type CalendarToolDeps
} from './tool-support';
import { toLocalIso } from './time';
import { freeWindows } from './windows';

export type { CalendarToolDeps } from './tool-support';

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

  registry.register(statusTool, async (): Promise<ToolResult> => {
    const now = deps.now();
    const state = situation(await deps.provider(), deps.config(), now);
    const line = situationLine(state, now);
    return ok(line, state, { say: line });
  });

  registry.register(syncTool, async (args): Promise<ToolResult> => {
    if (deps.sync === undefined) {
      return fail('Перенос встреч из почты не настроен: добавьте подключение Exchange');
    }
    const enable = args.enable;
    if (enable !== undefined && typeof enable !== 'boolean') {
      return fail('Поле enable должно быть true или false');
    }
    const result = await deps.sync(enable);
    if (!result.ok) {
      return fail(result.error ?? 'Не удалось загрузить встречи из почты');
    }
    const content = `Добавлено ${result.added}, изменено ${result.updated}, убрано ${result.removed}`;
    return ok(content, result, { say: syncSay(enable) });
  });
}

function syncSay(enable?: boolean): string {
  if (enable === true) {
    return 'Включила перенос встреч из почты в календарь';
  }
  if (enable === false) {
    return 'Больше не переношу встречи из почты';
  }
  return 'Обновила встречи из почты';
}
