import { button, clear, el } from '../../settings/dom';

export type CalendarView = 'day' | 'week';

export interface CalendarChrome {
  header: HTMLElement;
  bar: HTMLElement;
  gridBox: HTMLElement;
  listBox: HTMLElement;
  settingsBox: HTMLElement;
  editorBox: HTMLElement;
  dayButton: HTMLButtonElement;
  weekButton: HTMLButtonElement;
  today: HTMLButtonElement;
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
  addButton: HTMLButtonElement;
  busyHour: HTMLButtonElement;
  busyDay: HTMLButtonElement;
}

export function buildCalendarChrome(root: HTMLElement): CalendarChrome {
  clear(root);
  const header = el('header', 'calendar-header');
  header.append(el('h1', 'automations-title', 'Календарь'));
  const toolbar = el('div', 'calendar-toolbar');
  const dayButton = button('День', 'automations-tab');
  const weekButton = button('Неделя', 'automations-tab');
  const today = button('Сегодня', 'ghost-button');
  const prev = button('‹', 'icon-button');
  const next = button('›', 'icon-button');
  const addButton = button('Событие', 'button primary');
  toolbar.append(dayButton, weekButton, el('span', 'calendar-toolbar-gap'), today, prev, next, addButton);
  const bar = el('div', 'calendar-bar');
  const actions = el('div', 'calendar-quick');
  const busyHour = button('Занят час', 'ghost-button');
  const busyDay = button('Занят до конца дня', 'ghost-button');
  actions.append(busyHour, busyDay);
  header.append(toolbar, bar, actions);

  const gridBox = el('div', 'calendar-grid-box');
  const listBox = el('div', 'calendar-today');
  const settingsBox = el('div', 'calendar-settings');
  const editorBox = el('div', 'calendar-editor-slot');
  root.append(header, gridBox, listBox, settingsBox, editorBox);

  return {
    header, bar, gridBox, listBox, settingsBox, editorBox,
    dayButton, weekButton, today, prev, next, addButton, busyHour, busyDay
  };
}

export interface CalendarControlHandlers {
  selectView(view: CalendarView): void;
  prev(): void;
  next(): void;
  today(): void;
  add(): void;
  busyHour(): void;
  busyDay(): void;
}

export function wireCalendarControls(chrome: CalendarChrome, handlers: CalendarControlHandlers): void {
  chrome.dayButton.addEventListener('click', () => handlers.selectView('day'));
  chrome.weekButton.addEventListener('click', () => handlers.selectView('week'));
  chrome.today.addEventListener('click', () => handlers.today());
  chrome.prev.addEventListener('click', () => handlers.prev());
  chrome.next.addEventListener('click', () => handlers.next());
  chrome.addButton.addEventListener('click', () => handlers.add());
  chrome.busyHour.addEventListener('click', () => handlers.busyHour());
  chrome.busyDay.addEventListener('click', () => handlers.busyDay());
}
