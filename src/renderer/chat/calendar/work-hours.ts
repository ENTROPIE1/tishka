import { WEEKDAYS } from '../../../core/calendar/types';
import type { CalendarConfig, CalendarDayHours } from '../../../core/calendar/types';
import { el, textInput } from '../../settings/dom';

export interface WorkHoursChange {
  workHours?: CalendarConfig['workHours'];
  defaultRemindMinutes?: number;
  quietOutsideWork?: boolean;
}

const DAY_LABELS: Record<string, string> = {
  mon: 'Пн',
  tue: 'Вт',
  wed: 'Ср',
  thu: 'Чт',
  fri: 'Пт',
  sat: 'Сб',
  sun: 'Вс'
};

function dayEditor(day: string, hours: CalendarDayHours | null, onChange: (next: CalendarDayHours | null) => void): HTMLElement {
  const row = el('div', 'calendar-day');
  const toggle = textInput('', 'checkbox');
  toggle.checked = hours !== null;
  row.append(el('span', 'calendar-day-name', DAY_LABELS[day] ?? day));
  const start = textInput(hours?.start ?? '09:00', 'time');
  const end = textInput(hours?.end ?? '18:00', 'time');
  start.disabled = !toggle.checked;
  end.disabled = !toggle.checked;
  const read = (): CalendarDayHours | null => (toggle.checked ? { start: start.value, end: end.value } : null);
  toggle.addEventListener('change', () => {
    start.disabled = !toggle.checked;
    end.disabled = !toggle.checked;
    onChange(read());
  });
  start.addEventListener('change', () => onChange(read()));
  end.addEventListener('change', () => onChange(read()));
  row.append(toggle, start, el('span', 'calendar-day-dash', '—'), end);
  return row;
}

export function renderWorkHours(
  container: HTMLElement,
  config: CalendarConfig,
  save: (change: WorkHoursChange) => void
): void {
  const details = el('details', 'section calendar-block');
  const summary = el('summary', 'section-title', 'Рабочее время');
  details.append(summary);

  const days = el('div', 'calendar-days');
  const workHours = config.workHours;
  for (const day of WEEKDAYS) {
    days.append(
      dayEditor(day, workHours.days[day] ?? null, (next) => {
        save({ workHours: { ...workHours, days: { ...workHours.days, [day]: next } } });
      })
    );
  }
  details.append(days);

  const lunchRow = el('div', 'calendar-day');
  const lunch = workHours.lunch;
  const lunchToggle = textInput('', 'checkbox');
  lunchToggle.checked = lunch !== undefined;
  const lunchStart = textInput(lunch?.start ?? '13:00', 'time');
  const lunchEnd = textInput(lunch?.end ?? '14:00', 'time');
  lunchStart.disabled = !lunchToggle.checked;
  lunchEnd.disabled = !lunchToggle.checked;
  const readLunch = (): void => {
    const next = lunchToggle.checked ? { start: lunchStart.value, end: lunchEnd.value } : undefined;
    const merged = { ...workHours };
    if (next === undefined) {
      delete merged.lunch;
    } else {
      merged.lunch = next;
    }
    save({ workHours: merged });
  };
  lunchToggle.addEventListener('change', () => {
    lunchStart.disabled = !lunchToggle.checked;
    lunchEnd.disabled = !lunchToggle.checked;
    readLunch();
  });
  lunchStart.addEventListener('change', readLunch);
  lunchEnd.addEventListener('change', readLunch);
  lunchRow.append(el('span', 'calendar-day-name', 'Обед'), lunchToggle, lunchStart, el('span', 'calendar-day-dash', '—'), lunchEnd);
  details.append(lunchRow);

  const remindRow = el('div', 'calendar-day');
  const remind = textInput(String(config.defaultRemindMinutes), 'number');
  remind.min = '0';
  remind.addEventListener('change', () => save({ defaultRemindMinutes: Math.max(0, Number(remind.value) || 0) }));
  remindRow.append(el('span', 'calendar-day-name', 'Напоминать за'), remind, el('span', 'calendar-day-name', 'минут'));
  details.append(remindRow);

  const quietRow = el('div', 'calendar-day');
  const quiet = textInput('', 'checkbox');
  quiet.checked = config.quietOutsideWork;
  quiet.addEventListener('change', () => save({ quietOutsideWork: quiet.checked }));
  quietRow.append(el('span', 'calendar-day-name', 'Вне рабочего времени не напоминать вслух о встречах'), quiet);
  details.append(quietRow);

  container.append(details);
}
