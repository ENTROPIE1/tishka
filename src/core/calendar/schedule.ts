import type { TriggerState } from '../triggers/state';
import type { Skill } from '../types';
import { toLocalIso } from './time';
import type { CalendarEvent } from './types';

const MINUTE_MS = 60_000;

// Напоминания и разовые запуски навыков по расписанию видны в календаре как
// события только для чтения. Ничего не копируется: события считаются из
// существующего состояния расписания при каждом чтении.
export function scheduleEvents(state: TriggerState, skills: Skill[] = []): CalendarEvent[] {
  const events: CalendarEvent[] = [];

  for (const reminder of state.reminders) {
    if (reminder.done) {
      continue;
    }
    const at = Date.parse(reminder.at);
    if (Number.isNaN(at)) {
      continue;
    }
    events.push({
      id: `schedule:reminder:${reminder.id}`,
      title: reminder.text,
      start: toLocalIso(new Date(at)),
      end: toLocalIso(new Date(at + MINUTE_MS)),
      allDay: false,
      kind: 'reminder',
      source: 'schedule',
      remindMinutes: null,
      updatedAt: new Date(at).toISOString()
    });
  }

  for (const skill of skills) {
    if (skill.trigger.type !== 'schedule' || skill.enabled === false) {
      continue;
    }
    const at = skill.trigger.at;
    if (at === undefined) {
      continue;
    }
    const ms = Date.parse(at);
    if (Number.isNaN(ms)) {
      continue;
    }
    events.push({
      id: `schedule:skill:${skill.id}`,
      title: skill.name,
      start: toLocalIso(new Date(ms)),
      end: toLocalIso(new Date(ms + MINUTE_MS)),
      allDay: false,
      kind: 'reminder',
      source: 'schedule',
      remindMinutes: null,
      updatedAt: new Date(ms).toISOString()
    });
  }

  return events;
}
