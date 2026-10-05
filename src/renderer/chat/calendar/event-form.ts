import { atTime, toLocalIso } from '../../../core/calendar/time';
import type { CalendarEvent, CalendarKind } from '../../../core/calendar/types';
import { button, el, field, selectInput, textarea, textInput } from '../../settings/dom';
import type { CalendarApi } from './deps';

const KIND_OPTIONS = [
  { value: 'meeting', label: 'Встреча' },
  { value: 'focus', label: 'Занят, не отвлекать' },
  { value: 'personal', label: 'Личное' },
  { value: 'reminder', label: 'Напоминание' },
  { value: 'away', label: 'Отсутствую' }
];

const REMIND_OPTIONS = [
  { value: 'null', label: 'Не напоминать' },
  { value: '5', label: 'За 5 минут' },
  { value: '10', label: 'За 10 минут' },
  { value: '15', label: 'За 15 минут' },
  { value: '30', label: 'За 30 минут' }
];

function dateValue(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function timeValue(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function combine(date: string, time: string): string {
  const parsed = new Date(`${date}T${time}:00`);
  return toLocalIso(parsed);
}

export interface EventFormOptions {
  event?: CalendarEvent;
  day: Date;
  startMin: number;
  api: CalendarApi;
  onSaved(): void;
}

export function openEventForm(container: HTMLElement, options: EventFormOptions): void {
  const existing = options.event;
  const editable = existing === undefined || existing.source === 'local';
  const defaultStart = existing === undefined ? atTime(options.day, options.startMin) : new Date(existing.start);
  const defaultEnd = existing === undefined ? atTime(options.day, options.startMin + 60) : new Date(existing.end);

  const form = el('form', 'editor calendar-editor');
  form.append(el('h2', 'section-title', existing === undefined ? 'Новое событие' : 'Событие'));

  const title = textInput(existing?.title ?? '');
  title.placeholder = 'Например, Планёрка';
  const kind = selectInput(KIND_OPTIONS, existing?.kind ?? 'meeting');
  const date = textInput(dateValue(defaultStart.toISOString()), 'date');
  const start = textInput(timeValue(defaultStart.toISOString()), 'time');
  const end = textInput(timeValue(defaultEnd.toISOString()), 'time');
  const allDay = textInput('', 'checkbox');
  allDay.checked = existing?.allDay ?? false;
  const remind = selectInput(REMIND_OPTIONS, existing?.remindMinutes === null || existing?.remindMinutes === undefined ? 'null' : String(existing.remindMinutes));
  const note = textarea(existing?.note ?? '', 'Заметка');

  if (!editable) {
    title.disabled = true;
    kind.disabled = true;
  }
  form.append(field('Название', title));
  form.append(field('Вид', kind));
  if (existing === undefined) {
    form.append(field('Дата', date));
    form.append(field('Начало', start));
    form.append(field('Конец', end));
    form.append(field('Весь день', allDay));
  }
  form.append(field('Напоминание', remind));
  form.append(field('Заметка', note));

  if (existing !== undefined && !editable) {
    const source = existing.source === 'schedule' ? 'расписание' : existing.source.replace('exchange:', 'почта: ');
    form.append(el('p', 'field-hint', `Загружено: ${source}. Меняются только напоминание и заметка.`));
  }

  const actions = el('div', 'calendar-form-actions');
  const save = button('Сохранить', 'button primary');
  save.type = 'submit';
  actions.append(save);
  if (existing !== undefined && editable) {
    const remove = button('Удалить', 'button danger');
    remove.addEventListener('click', async (clickEvent) => {
      clickEvent.preventDefault();
      if (!window.confirm('Удалить событие?')) {
        return;
      }
      await options.api.remove(existing.id);
      form.remove();
      options.onSaved();
    });
    actions.append(remove);
  }
  const cancel = button('Отмена', 'ghost-button');
  cancel.addEventListener('click', () => {
    form.remove();
  });
  actions.append(cancel);
  form.append(actions);

  form.addEventListener('submit', async (submitEvent) => {
    submitEvent.preventDefault();
    const remindValue = remind.value === 'null' ? null : Number(remind.value);
    const noteValue = note.value.trim();
    if (existing === undefined || editable) {
      const payload = {
        title: title.value.trim() || 'Событие',
        start: allDay.checked ? combine(date.value, '00:00') : combine(date.value, start.value),
        end: allDay.checked ? combine(date.value, '23:59') : combine(date.value, end.value),
        allDay: allDay.checked,
        kind: kind.value as CalendarKind,
        remindMinutes: remindValue,
        note: noteValue
      };
      if (existing === undefined) {
        await options.api.add(payload);
      } else {
        await options.api.update(existing.id, payload);
      }
    } else {
      await options.api.update(existing.id, { remindMinutes: remindValue, note: noteValue });
    }
    form.remove();
    options.onSaved();
  });

  container.append(form);
  title.focus();
}
