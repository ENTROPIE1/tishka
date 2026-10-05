import { parseMinutes, weekdayOf } from '../../../core/calendar/time';
import type { CalendarEvent } from '../../../core/calendar/types';
import { el } from '../../settings/dom';
import type { WorkHours } from './deps';
import { allDayEvents, layoutDay } from './layout';

export const HOUR_HEIGHT = 44;

const WEEKDAY_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

const KIND_MARK: Record<string, string> = {
  meeting: '●',
  focus: '■',
  personal: '◆',
  reminder: '○',
  away: '△'
};

export interface GridCallbacks {
  onSelectSlot(day: Date, startMin: number): void;
  onSelectEvent(event: CalendarEvent): void;
  onSelectAllDay(day: Date): void;
  now: Date;
}

function workRange(workHours: WorkHours, day: Date): { start: number; end: number } | null {
  const hours = workHours.days[weekdayOf(day)] ?? null;
  if (hours === null) {
    return null;
  }
  const start = parseMinutes(hours.start);
  const end = parseMinutes(hours.end);
  return start === undefined || end === undefined ? null : { start, end };
}

function minutesOfNow(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

function timeLabel(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function sourceLabel(event: CalendarEvent): string | null {
  if (event.source === 'schedule') {
    return 'расписание';
  }
  return event.source.startsWith('exchange:') ? 'почта' : null;
}

function eventBlock(event: CalendarEvent, callbacks: GridCallbacks, position?: { top: number; height: number; column: number; columns: number }): HTMLElement {
  const block = el('button', `calendar-event kind-${event.kind}`);
  block.type = 'button';
  block.dataset['eventId'] = event.id;
  const head = el('span', 'calendar-event-head');
  head.append(el('span', 'calendar-event-icon', KIND_MARK[event.kind] ?? '●'));
  head.append(el('span', 'calendar-event-time', timeLabel(event.start)));
  const source = sourceLabel(event);
  if (source !== null) {
    head.append(el('span', 'calendar-event-source', source));
  }
  block.append(head);
  block.append(el('span', 'calendar-event-title', event.title));
  if (position !== undefined) {
    block.style.top = `${position.top}px`;
    block.style.height = `${position.height}px`;
    block.style.left = `${(position.column / position.columns) * 100}%`;
    block.style.width = `${100 / position.columns}%`;
  }
  block.addEventListener('click', (clickEvent) => {
    clickEvent.stopPropagation();
    callbacks.onSelectEvent(event);
  });
  return block;
}

function renderAllDay(container: HTMLElement, days: Date[], events: CalendarEvent[], callbacks: GridCallbacks): void {
  const row = el('div', 'calendar-allday');
  for (const day of days) {
    const cell = el('div', 'calendar-allday-cell');
    if (days.length > 1) {
      cell.append(el('span', 'calendar-allday-day', WEEKDAY_SHORT[day.getDay()]));
    }
    for (const event of allDayEvents(events, day)) {
      const chip = eventBlock(event, callbacks);
      chip.classList.add('calendar-allday-chip');
      chip.style.position = '';
      cell.append(chip);
    }
    cell.addEventListener('click', () => callbacks.onSelectAllDay(day));
    row.append(cell);
  }
  container.append(row);
}

function renderColumns(container: HTMLElement, days: Date[], events: CalendarEvent[], workHours: WorkHours, callbacks: GridCallbacks): void {
  const body = el('div', 'calendar-body');
  const times = el('div', 'calendar-times');
  for (let hour = 0; hour < 24; hour += 1) {
    const cell = el('div', 'calendar-time', `${String(hour).padStart(2, '0')}:00`);
    cell.style.height = `${HOUR_HEIGHT}px`;
    times.append(cell);
  }
  body.append(times);

  const cols = el('div', 'calendar-cols');
  const today = callbacks.now;
  for (const day of days) {
    const col = el('div', 'calendar-col');
    col.dataset['day'] = day.toISOString().slice(0, 10);
    const hours = el('div', 'calendar-col-hours');
    const range = workRange(workHours, day);
    for (let hour = 0; hour < 24; hour += 1) {
      const cell = el('div', 'calendar-hour');
      cell.style.height = `${HOUR_HEIGHT}px`;
      if (range !== null && hour * 60 >= range.start && hour * 60 < range.end) {
        cell.classList.add('work');
      }
      hours.append(cell);
    }
    hours.addEventListener('click', (clickEvent) => {
      const rect = hours.getBoundingClientRect();
      const offset = clickEvent.clientY - rect.top;
      const minutes = Math.max(0, Math.min(23 * 60, Math.floor((offset / HOUR_HEIGHT) * 60 / 30) * 30));
      callbacks.onSelectSlot(day, minutes);
    });
    col.append(hours);

    const layer = el('div', 'calendar-col-events');
    for (const item of layoutDay(events, day)) {
      const top = (item.startMin / 60) * HOUR_HEIGHT;
      const height = ((item.endMin - item.startMin) / 60) * HOUR_HEIGHT;
      layer.append(eventBlock(item.event, callbacks, { top, height, column: item.column, columns: item.columns }));
    }
    col.append(layer);

    if (day.toDateString() === today.toDateString()) {
      const line = el('div', 'calendar-now');
      line.style.top = `${(minutesOfNow(today) / 60) * HOUR_HEIGHT}px`;
      line.append(el('span', 'calendar-now-dot'));
      col.append(line);
    }
    cols.append(col);
  }
  body.append(cols);
  container.append(body);
}

export function renderGrid(
  container: HTMLElement,
  days: Date[],
  events: CalendarEvent[],
  workHours: WorkHours,
  callbacks: GridCallbacks
): void {
  container.replaceChildren();
  const grid = el('div', 'calendar-grid');
  if (days.length > 1) {
    const header = el('div', 'calendar-week-header');
    header.append(el('div', 'calendar-week-gutter'));
    for (const day of days) {
      header.append(el('div', 'calendar-week-day', `${WEEKDAY_SHORT[day.getDay()]} ${day.getDate()}`));
    }
    grid.append(header);
  }
  renderAllDay(grid, days, events, callbacks);
  renderColumns(grid, days, events, workHours, callbacks);
  container.append(grid);
}

export function weekDays(anchor: Date): Date[] {
  const days: Date[] = [];
  const base = new Date(anchor);
  for (let index = 0; index < 7; index += 1) {
    const day = new Date(base);
    day.setDate(base.getDate() + index);
    days.push(day);
  }
  return days;
}
