import { eventSubtitle, eventTimeLabel } from '../../../core/calendar/format';
import { atTime, weekdayOf } from '../../../core/calendar/time';
import type { CalendarConfig, CalendarEvent, CalendarRange } from '../../../core/calendar/types';
import type { Config, TishkaEvent } from '../../../core/types';
import type { ConnectionView } from '../../../main/ipc-settings';
import { button, clear, el } from '../../settings/dom';
import type { CalendarApi, CalendarConfigApi, CalendarScreenDeps } from './deps';
import { openEventForm } from './event-form';
import { renderGrid, weekDays } from './grid';
import { addDays, isSameDay, startOfWeek } from './layout';
import { situationText } from './situation-bar';
import { renderSources, type SourceState } from './sources';
import { renderWorkHours, type WorkHoursChange } from './work-hours';

export interface CalendarScreen {
  refresh(): Promise<void>;
}

type View = 'day' | 'week';

function dayRange(day: Date): CalendarRange {
  const from = new Date(day);
  from.setHours(0, 0, 0, 0);
  const to = addDays(from, 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

function defaultApi(): CalendarApi {
  return window.tishka.calendar;
}

const DEFAULT_CONFIG: CalendarConfig = { workHours: { days: {} }, defaultRemindMinutes: 10, quietOutsideWork: false };

export function mountCalendarScreen(root: HTMLElement, deps: CalendarScreenDeps = {}): CalendarScreen {
  const api = deps.api ?? defaultApi();
  const configApi: CalendarConfigApi = deps.config ?? window.tishka.config;
  const loadConnections = deps.connections ?? (() => window.tishka.connections.status());
  const subscribe = deps.onEvent ?? ((listener: (event: TishkaEvent) => void) => window.tishka.onEvent(listener));
  const now = deps.now ?? (() => new Date());

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

  let view: View = 'day';
  let anchor = now();
  let events: CalendarEvent[] = [];
  let config: CalendarConfig = DEFAULT_CONFIG;
  let fullConfig: Config | undefined;
  let connections: ConnectionView[] = [];
  let sourceState: Record<string, SourceState> = {};

  function range(): CalendarRange {
    if (view === 'week') {
      const start = startOfWeek(anchor);
      return { from: start.toISOString(), to: addDays(start, 7).toISOString() };
    }
    return dayRange(anchor);
  }

  function days(): Date[] {
    return view === 'week' ? weekDays(startOfWeek(anchor)) : [anchor];
  }

  async function refresh(): Promise<void> {
    try {
      events = await api.events(range());
    } catch {
      events = [];
    }
    try {
      const configView = await configApi.get();
      fullConfig = configView.config;
      config = configView.config.calendar;
    } catch {
      /* настройки недоступны — показываем пустое рабочее время */
    }
    try {
      connections = await loadConnections();
    } catch {
      connections = [];
    }
    paint();
    matchBar();
  }

  async function matchBar(): Promise<void> {
    try {
      bar.textContent = situationText(await api.situation());
    } catch {
      bar.textContent = '';
    }
  }

  function paint(): void {
    dayButton.classList.toggle('active', view === 'day');
    weekButton.classList.toggle('active', view === 'week');
    renderGrid(
      gridBox,
      days(),
      events,
      config.workHours,
      {
        now: now(),
        onSelectSlot: (day, startMin) => openEventForm(editorBox, { day, startMin, api, onSaved: () => void refresh() }),
        onSelectEvent: (event) => openEventForm(editorBox, { event, day: new Date(event.start), startMin: 0, api, onSaved: () => void refresh() }),
        onSelectAllDay: (day) => openEventForm(editorBox, { day, startMin: 0, api, onSaved: () => void refresh() })
      }
    );
    renderToday();
    renderSettings();
    renderEmptyHint();
  }

  function renderToday(): void {
    clear(listBox);
    listBox.append(el('h2', 'section-title', 'Сегодня'));
    const todayList = events
      .filter((event) => isSameDay(new Date(event.start), now()))
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
      row.addEventListener('click', () =>
        openEventForm(editorBox, { event, day: new Date(event.start), startMin: 0, api, onSaved: () => void refresh() })
      );
      listBox.append(row);
    }
  }

  function renderSettings(): void {
    clear(settingsBox);
    renderWorkHours(settingsBox, config, (change) => void saveWorkHours(change));
    renderSources(settingsBox, {
      connections,
      sources: fullConfig?.calendar.sources ?? {},
      state: sourceState,
      syncEnabled: typeof api.sync === 'function',
      onToggle: (name, enabled) => void saveSources(name, enabled),
      onSync: () => void runSync()
    });
  }

  function renderEmptyHint(): void {
    const existing = root.querySelector('.calendar-empty');
    if (events.length > 0) {
      existing?.remove();
      return;
    }
    if (existing !== null) {
      return;
    }
    const hint = el('p', 'calendar-empty field-hint', 'Скажите Тишке: «поставь в календарь встречу завтра в 15» или нажмите «Событие».');
    root.append(hint);
  }

  async function saveConfig(patch: Partial<Config['calendar']>): Promise<void> {
    if (fullConfig === undefined) {
      return;
    }
    const next: Config = { ...fullConfig, calendar: { ...fullConfig.calendar, ...patch } };
    await configApi.save(next);
    fullConfig = next;
    config = next.calendar;
    paint();
    matchBar();
  }

  function saveWorkHours(change: WorkHoursChange): void {
    void saveConfig(change as Partial<Config['calendar']>);
  }

  function saveSources(name: string, enabled: boolean): void {
    const sources = { ...(fullConfig?.calendar.sources ?? {}), [name]: enabled };
    void saveConfig({ sources });
  }

  async function runSync(): Promise<void> {
    if (typeof api.sync !== 'function') {
      return;
    }
    try {
      const result = await api.sync();
      sourceState = { ...sourceState, ...describeResult(result) };
    } catch {
      /* ошибку покажет refresh по событию */
    }
    await refresh();
  }

  function describeResult(result: { added: number; updated: number; removed: number; error?: string }): Record<string, SourceState> {
    const state: SourceState = { loadedAt: new Date().toISOString(), added: result.added, updated: result.updated, removed: result.removed };
    if (result.error !== undefined) {
      state.error = result.error;
    }
    const next: Record<string, SourceState> = {};
    for (const connection of connections) {
      next[connection.name] = state;
    }
    return next;
  }

  function addQuick(startMin: number, durationMin: number): void {
    const day = now();
    void api
      .add({
        title: 'Занят',
        start: atTime(day, startMin).toISOString(),
        end: atTime(day, startMin + durationMin).toISOString(),
        kind: 'focus',
        remindMinutes: null
      })
      .then(() => refresh());
  }

  dayButton.addEventListener('click', () => {
    view = 'day';
    void refresh();
  });
  weekButton.addEventListener('click', () => {
    view = 'week';
    void refresh();
  });
  today.addEventListener('click', () => {
    anchor = now();
    void refresh();
  });
  prev.addEventListener('click', () => {
    anchor = addDays(anchor, view === 'week' ? -7 : -1);
    void refresh();
  });
  next.addEventListener('click', () => {
    anchor = addDays(anchor, view === 'week' ? 7 : 1);
    void refresh();
  });
  addButton.addEventListener('click', () => {
    openEventForm(editorBox, { day: anchor, startMin: now().getHours() * 60, api, onSaved: () => void refresh() });
  });
  busyHour.addEventListener('click', () => {
    const nowDate = now();
    addQuick(nowDate.getHours() * 60 + nowDate.getMinutes(), 60);
  });
  busyDay.addEventListener('click', () => {
    const nowDate = now();
    const work = config.workHours.days[weekdayOf(nowDate)] ?? null;
    const endHour = work !== null ? Number(work.end.split(':')[0]) : 18;
    const startMin = nowDate.getHours() * 60 + nowDate.getMinutes();
    addQuick(startMin, Math.max(30, endHour * 60 - startMin));
  });

  subscribe((event) => {
    if (event.type === 'calendar.changed' || event.type === 'background.tick') {
      void refresh();
    }
  });
  window.setInterval(() => {
    paint();
    void matchBar();
  }, 60_000);

  void refresh();
  return { refresh };
}
