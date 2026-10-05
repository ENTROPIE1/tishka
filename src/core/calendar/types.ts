export type CalendarKind = 'meeting' | 'focus' | 'personal' | 'reminder' | 'away';

export type CalendarWeekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export interface CalendarDayHours {
  start: string;                // ЧЧ:ММ
  end: string;                  // ЧЧ:ММ
}

// Рабочее время по дням недели: null — выходной. Обед необязателен.
export interface CalendarWorkHours {
  days: Partial<Record<CalendarWeekday, CalendarDayHours | null>>;
  lunch?: CalendarDayHours;
}

export interface CalendarConfig {
  workHours: CalendarWorkHours;
  defaultRemindMinutes: number;   // за сколько напоминать по умолчанию
  quietOutsideWork: boolean;      // вне рабочего времени не напоминать вслух о рабочих встречах
  sources?: Record<string, boolean>;   // имя подключения Exchange — загружать встречи
}

// Источник события: завёл человек или Тишка, загружено из подключения, из расписания.
export type CalendarSource = 'local' | `exchange:${string}` | 'schedule';

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;                  // ISO со смещением
  end: string;                    // ISO со смещением
  allDay: boolean;
  kind: CalendarKind;
  source: CalendarSource;
  externalId?: string;            // идентификатор в источнике загрузки
  location?: string;
  link?: string;                  // ссылка на подключение к встрече
  note?: string;
  remindMinutes: number | null;   // null — не напоминать
  updatedAt: string;
}

export interface AddEventInput {
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  kind?: CalendarKind;
  source?: CalendarSource;
  externalId?: string;
  location?: string;
  link?: string;
  note?: string;
  remindMinutes?: number | null;
}

export interface UpdateEventPatch {
  title?: string;
  start?: string;
  end?: string;
  allDay?: boolean;
  kind?: CalendarKind;
  location?: string;
  link?: string;
  note?: string;
  remindMinutes?: number | null;
}

export interface CalendarRange {
  from?: string;
  to?: string;
}

export const WEEKDAYS: CalendarWeekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export function defaultWorkHours(): CalendarWorkHours {
  return {
    days: {
      mon: { start: '09:00', end: '18:00' },
      tue: { start: '09:00', end: '18:00' },
      wed: { start: '09:00', end: '18:00' },
      thu: { start: '09:00', end: '18:00' },
      fri: { start: '09:00', end: '18:00' },
      sat: null,
      sun: null
    }
  };
}

export function defaultCalendarConfig(): CalendarConfig {
  return { workHours: defaultWorkHours(), defaultRemindMinutes: 10, quietOutsideWork: false, sources: {} };
}
