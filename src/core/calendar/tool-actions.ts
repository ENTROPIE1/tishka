import type { ToolResult } from '../types';
import { eventTimeLabel } from './format';
import { CALENDAR_KINDS } from './tool-defs';
import {
  fail,
  num,
  ok,
  overlapping,
  parseInput,
  str,
  type CalendarToolDeps
} from './tool-support';
import { toLocalIso } from './time';
import type { AddEventInput, CalendarKind, UpdateEventPatch } from './types';

export async function addEvent(args: Record<string, unknown>, deps: CalendarToolDeps): Promise<ToolResult> {
  const title = str(args.title);
  if (title === undefined) {
    return fail('Поле title должно быть непустой строкой');
  }
  const now = deps.now();
  const source = str(args.when) ?? str(args.start);
  if (source === undefined) {
    return fail('Укажите начало: поле when или start');
  }
  const parsed = parseInput(source, now);
  if (parsed === undefined) {
    return fail('Не удалось разобрать время события');
  }
  const allDay = args.allDay === true || parsed.allDay;
  let start = parsed.start;
  let end = parsed.end;
  const explicitEnd = str(args.end);
  const duration = num(args.durationMinutes) ?? parsed.durationMinutes;
  if (explicitEnd !== undefined) {
    const endParsed = parseInput(explicitEnd, now);
    if (endParsed === undefined) {
      return fail('Не удалось разобрать конец события');
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
  const kind = typeof args.kind === 'string' && (CALENDAR_KINDS as string[]).includes(args.kind) ? (args.kind as CalendarKind) : 'meeting';
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

  const clashing = overlapping(await deps.provider(), start, end);
  const event = await deps.store.add(input);
  deps.emitChanged?.();
  const tail = clashing.length === 0 ? '' : ` Пересекается с: ${clashing.map((item) => `«${item.title}»`).join(', ')}.`;
  return ok(`Создал событие «${title}» на ${eventTimeLabel(event)}.${tail}`, event);
}

export function updateEvent(args: Record<string, unknown>, deps: CalendarToolDeps): Promise<ToolResult> {
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
  if (typeof args.kind === 'string' && (CALENDAR_KINDS as string[]).includes(args.kind)) {
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
