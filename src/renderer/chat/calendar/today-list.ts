import { eventSubtitle, eventTimeLabel } from '../../../core/calendar/format';
import type { CalendarEvent } from '../../../core/calendar/types';
import { button, clear, el } from '../../settings/dom';
import { isSameDay } from './layout';

// Список сегодняшних событий под сеткой: время, название, ссылка на подключение.
export function renderTodayList(
  listBox: HTMLElement,
  events: CalendarEvent[],
  now: Date,
  onOpen: (event: CalendarEvent) => void
): void {
  clear(listBox);
  listBox.append(el('h2', 'section-title', 'Сегодня'));
  const todayList = events
    .filter((event) => isSameDay(new Date(event.start), now))
    .sort((a, b) => a.start.localeCompare(b.start));
  if (todayList.length === 0) {
    listBox.append(el('p', 'field-hint', 'На сегодня событий нет.'));
    return;
  }
  for (const event of todayList) {
    const row = el('div', 'calendar-today-row');
    row.append(el('span', 'calendar-today-time', eventTimeLabel(event)));
    const info = el('div', 'calendar-today-info');
    info.append(el('span', 'calendar-today-title', event.title));
    info.append(el('span', 'field-hint', eventSubtitle(event)));
    row.append(info);
    if (event.link !== undefined && event.link !== '') {
      const link = button('Подключиться', 'ghost-button');
      link.addEventListener('click', () => void window.tishka.openExternal(event.link ?? ''));
      row.append(link);
    }
    row.addEventListener('click', () => onOpen(event));
    listBox.append(row);
  }
}

export function renderEmptyHint(root: HTMLElement, hasEvents: boolean): void {
  const existing = root.querySelector('.calendar-empty');
  if (hasEvents) {
    existing?.remove();
    return;
  }
  if (existing !== null) {
    return;
  }
  const hint = el('p', 'calendar-empty field-hint', 'Скажите Тишке: «поставь в календарь встречу завтра в 15» или нажмите «Событие».');
  root.append(hint);
}
