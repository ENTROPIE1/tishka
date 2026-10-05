import { el } from '../../settings/dom';
import type { ConnectionView } from '../../../main/ipc-settings';

export interface SourceState {
  loadedAt?: string;
  error?: string;
  added?: number;
  updated?: number;
  removed?: number;
}

export interface SourcesDeps {
  connections: ConnectionView[];
  sources: Record<string, boolean>;
  state?: Record<string, SourceState>;
  onToggle(name: string, enabled: boolean): void;
  onSync(): void;
  syncEnabled: boolean;
}

export function renderSources(container: HTMLElement, deps: SourcesDeps): void {
  const details = el('details', 'section calendar-block');
  details.append(el('summary', 'section-title', 'Источники'));

  const exchange = deps.connections.filter((connection) => connection.template === 'exchange');
  if (exchange.length === 0) {
    details.append(el('p', 'field-hint', 'Подключений Exchange нет. Добавьте в «Подключениях».'));
    container.append(details);
    return;
  }

  for (const connection of exchange) {
    const row = el('div', 'calendar-source');
    const toggle = el('input', 'checkbox');
    toggle.type = 'checkbox';
    toggle.checked = deps.sources[connection.name] === true;
    toggle.addEventListener('change', () => deps.onToggle(connection.name, toggle.checked));
    const info = el('div', 'calendar-source-info');
    info.append(el('span', 'calendar-source-name', connection.name));
    info.append(el('span', 'field-hint', connection.address));
    const state = deps.state?.[connection.name];
    info.append(el('span', 'field-hint', describeState(state)));
    row.append(toggle, el('span', 'calendar-source-toggle', 'Загружать встречи'), info);
    details.append(row);
  }

  const sync = el('button', 'button', 'Обновить сейчас');
  sync.type = 'button';
  sync.disabled = !deps.syncEnabled;
  sync.addEventListener('click', () => deps.onSync());
  details.append(sync);

  container.append(details);
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
