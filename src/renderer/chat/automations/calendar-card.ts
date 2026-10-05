import type { SourceState } from '../../../main/ipc-calendar';
import type { ConnectionView } from '../../../main/ipc-settings';
import { el } from '../../settings/dom';

export interface CalendarAutomationDeps {
  connections: ConnectionView[];
  sources: Record<string, boolean>;
  state: Record<string, SourceState>;
  running?: boolean;
  onToggle(name: string, enabled: boolean): void;
  onRun(): void;
}

// Встроенная автоматизация: в отличие от навыков, её настройка — это те же
// источники календаря, поэтому переключатель карточки и «Источников» один.
export function calendarAutomationCard(deps: CalendarAutomationDeps): HTMLElement {
  const box = el('div', 'skill-card calendar-card');
  box.dataset['builtin'] = 'calendar';
  const head = el('div', 'skill-card-head');
  const icon = el('span', 'skill-kind', '✉');
  icon.title = 'Встроенная автоматизация';
  const titles = el('div', 'skill-titles');
  titles.append(
    el('div', 'skill-name', 'Встречи из почты в календарь'),
    el('div', 'skill-summary', 'Проверяет почтовый календарь Exchange и переносит встречи в мой')
  );
  const exchange = deps.connections.filter((connection) => connection.template === 'exchange');
  const enabled = exchange.some((connection) => deps.sources[connection.name] === true);
  const state = el(
    'span',
    `skill-state ${enabled ? 'state-active' : 'state-paused'}`,
    enabled ? 'включена' : 'выключена'
  );
  head.append(icon, titles, state);
  box.append(head);

  if (exchange.length === 0) {
    box.append(el('p', 'field-hint', 'Подключений Exchange нет. Добавьте в «Подключениях».'));
    return box;
  }

  for (const connection of exchange) {
    box.append(sourceRow(connection, deps));
  }

  const run = el('button', 'button', 'Запустить сейчас');
  run.type = 'button';
  run.disabled = !enabled || deps.running === true;
  run.addEventListener('click', () => deps.onRun());
  box.append(run);
  return box;
}

function sourceRow(connection: ConnectionView, deps: CalendarAutomationDeps): HTMLElement {
  const row = el('div', 'calendar-source');
  const toggle = el('input', 'checkbox');
  toggle.type = 'checkbox';
  toggle.checked = deps.sources[connection.name] === true;
  toggle.addEventListener('change', () => deps.onToggle(connection.name, toggle.checked));
  const info = el('div', 'calendar-source-info');
  info.append(el('span', 'calendar-source-name', connection.name));
  info.append(el('span', 'field-hint', connection.address));
  info.append(el('span', 'field-hint', describeState(deps.state[connection.name])));
  row.append(toggle, el('span', 'calendar-source-toggle', 'Загружать встречи'), info);
  return row;
}

function describeState(state: SourceState | undefined): string {
  if (state === undefined) {
    return 'Ещё не загружалось';
  }
  const time =
    state.loadedAt === undefined
      ? ''
      : `Последняя удачная загрузка: ${new Date(state.loadedAt).toLocaleString('ru-RU')}`;
  if (state.error !== undefined) {
    return time === '' ? `Ошибка: ${state.error}` : `Ошибка: ${state.error}. ${time}`;
  }
  const counts = `добавлено ${state.added ?? 0}, изменено ${state.updated ?? 0}, убрано ${state.removed ?? 0}`;
  return `${time}. ${counts}`;
}
