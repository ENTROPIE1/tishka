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

  box.append(
    el('p', 'field-hint', 'Включается в Календаре, блок «Источники». Здесь только запуск.')
  );

  const run = el('button', 'button', 'Запустить сейчас');
  run.type = 'button';
  run.disabled = !enabled || deps.running === true;
  run.addEventListener('click', () => deps.onRun());
  box.append(run);
  return box;
}

