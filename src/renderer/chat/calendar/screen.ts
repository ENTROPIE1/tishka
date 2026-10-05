import { weekdayOf } from '../../../core/calendar/time';
import type { CalendarConfig, CalendarEvent, CalendarRange } from '../../../core/calendar/types';
import type { Config, TishkaEvent } from '../../../core/types';
import type { ConnectionView } from '../../../main/ipc-settings';
import type { CalendarConfigApi, CalendarScreenDeps } from './deps';
import { openEventForm } from './event-form';
import { renderGrid, weekDays } from './grid';
import { addDays, startOfWeek } from './layout';
import { buildCalendarChrome, wireCalendarControls, type CalendarView } from './screen-chrome';
import { addQuickFocus, dayRange, defaultApi, DEFAULT_CONFIG } from './screen-support';
import { renderSettingsPanel, syncResultState } from './settings-panel';
import { situationText } from './situation-bar';
import type { SourceState } from './sources';
import { renderEmptyHint, renderTodayList } from './today-list';
import type { WorkHoursChange } from './work-hours';

export interface CalendarScreen {
  refresh(): Promise<void>;
}

export function mountCalendarScreen(root: HTMLElement, deps: CalendarScreenDeps = {}): CalendarScreen {
  const api = deps.api ?? defaultApi();
  const configApi: CalendarConfigApi = deps.config ?? window.tishka.config;
  const loadConnections = deps.connections ?? (() => window.tishka.connections.status());
  const subscribe = deps.onEvent ?? ((listener: (event: TishkaEvent) => void) => window.tishka.onEvent(listener));
  const now = deps.now ?? (() => new Date());

  const chrome = buildCalendarChrome(root);
  const { bar, gridBox, listBox, settingsBox, editorBox, dayButton, weekButton } = chrome;

  let view: CalendarView = 'day';
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
    renderTodayList(listBox, events, now(), (event) =>
      openEventForm(editorBox, { event, day: new Date(event.start), startMin: 0, api, onSaved: () => void refresh() })
    );
    renderSettings();
    renderEmptyHint(root, events.length > 0);
  }

  function renderSettings(): void {
    renderSettingsPanel({
      box: settingsBox,
      config,
      sources: fullConfig?.calendar.sources ?? {},
      connections,
      state: sourceState,
      syncEnabled: typeof api.sync === 'function',
      onWorkHours: saveWorkHours,
      onToggle: saveSources,
      onSync: () => void runSync()
    });
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
      sourceState = { ...sourceState, ...syncResultState(connections, result) };
    } catch {
      /* ошибку покажет refresh по событию */
    }
    await refresh();
  }

  function addQuick(startMin: number, durationMin: number): void {
    addQuickFocus(api, now(), startMin, durationMin, () => void refresh());
  }

  wireCalendarControls(chrome, {
    selectView: (next) => {
      view = next;
      void refresh();
    },
    prev: () => {
      anchor = addDays(anchor, view === 'week' ? -7 : -1);
      void refresh();
    },
    next: () => {
      anchor = addDays(anchor, view === 'week' ? 7 : 1);
      void refresh();
    },
    today: () => {
      anchor = now();
      void refresh();
    },
    add: () => {
      openEventForm(editorBox, { day: anchor, startMin: now().getHours() * 60, api, onSaved: () => void refresh() });
    },
    busyHour: () => {
      const day = now();
      addQuick(day.getHours() * 60 + day.getMinutes(), 60);
    },
    busyDay: () => {
      const day = now();
      const work = config.workHours.days[weekdayOf(day)] ?? null;
      const endHour = work !== null ? Number(work.end.split(':')[0]) : 18;
      const startMin = day.getHours() * 60 + day.getMinutes();
      addQuick(startMin, Math.max(30, endHour * 60 - startMin));
    }
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
