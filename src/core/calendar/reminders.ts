import type { EventBus, TishkaEvent } from '../types';
import { isWorkTime } from './situation';
import type { CalendarConfig, CalendarEvent } from './types';

export interface CalendarReminders {
  tick(): Promise<void>;
}

export interface FocusGate extends EventBus {
  flush(): void;
  pendingCount(): number;
}

const MISSED_LIMIT_MS = 5 * 60_000;

// Уведомления, пришедшие во время события focus, не показываются сразу:
// копятся и выпускаются приглушённой строкой после его конца.
export function createFocusGate(opts: { bus: EventBus; isFocusActive: () => boolean }): FocusGate {
  const pending: TishkaEvent[] = [];
  return {
    emit(event: TishkaEvent): void {
      if (event.type === 'notify' && opts.isFocusActive()) {
        pending.push(event);
        return;
      }
      opts.bus.emit(event);
    },
    on(listener: (event: TishkaEvent) => void): () => void {
      return opts.bus.on(listener);
    },
    flush(): void {
      if (opts.isFocusActive()) {
        return;
      }
      while (pending.length > 0) {
        const event = pending.shift();
        if (event !== undefined && event.type === 'notify') {
          opts.bus.emit({ type: 'note', text: event.title });
        }
      }
    },
    pendingCount(): number {
      return pending.length;
    }
  };
}

function plural(count: number, one: string, few: string, many: string): string {
  const tens = count % 100;
  const ones = count % 10;
  if (ones === 1 && tens !== 11) {
    return one;
  }
  if (ones >= 2 && ones <= 4 && (tens < 10 || tens >= 20)) {
    return few;
  }
  return many;
}

export function reminderText(event: CalendarEvent, now: Date): string {
  const minutes = Math.max(0, Math.round((Date.parse(event.start) - now.getTime()) / 60_000));
  const when = `Через ${minutes} ${plural(minutes, 'минуту', 'минуты', 'минут')}`;
  const link = event.link === undefined || event.link === '' ? '' : ` — ${event.link}`;
  return `${when} «${event.title}»${link}`;
}

export interface CalendarRemindersDeps {
  events: () => CalendarEvent[] | Promise<CalendarEvent[]>;
  now: () => Date;
  bus: EventBus;
  config: () => CalendarConfig;
  flush?: () => void;
}

// Напоминание о событии шлётся один раз за запуск; пропущенное больше пяти
// минут после перезапуска не шлётся вовсе.
export function createCalendarReminders(deps: CalendarRemindersDeps): CalendarReminders {
  const fired = new Set<string>();

  return {
    async tick(): Promise<void> {
      const now = deps.now();
      const nowMs = now.getTime();
      const list = await deps.events();
      deps.flush?.();
      const config = deps.config();

      for (const event of list) {
        if (event.remindMinutes === null || fired.has(event.id)) {
          continue;
        }
        const remindAt = Date.parse(event.start) - event.remindMinutes * 60_000;
        if (Number.isNaN(remindAt) || nowMs < remindAt) {
          continue;
        }
        fired.add(event.id);
        if (nowMs - remindAt > MISSED_LIMIT_MS) {
          continue;
        }
        const text = reminderText(event, now);
        if (config.quietOutsideWork && event.kind === 'meeting' && !isWorkTime(config, now)) {
          deps.bus.emit({ type: 'note', text });
        } else {
          deps.bus.emit({ type: 'notify', title: text });
        }
      }
    }
  };
}
