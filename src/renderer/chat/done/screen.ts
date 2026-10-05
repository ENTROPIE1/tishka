import type { StatsPeriod, StatsSummary } from '../../../core/types';
import { clear, el } from '../../settings/dom';

export interface DoneScreen {
  refresh(): Promise<void>;
}

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function periodText(period: StatsPeriod): string {
  return `${period.deeds} дел · ${period.minutes} мин`;
}

function weekdayChart(summary: StatsSummary): HTMLElement {
  const max = Math.max(1, ...summary.byWeekday.map((day) => day.deeds));
  const chart = el('div', 'done-chart');
  summary.byWeekday.forEach((day, index) => {
    const column = el('div', 'done-col');
    const bar = el('div', 'done-bar');
    bar.style.height = `${Math.round((day.deeds / max) * 100)}%`;
    bar.title = `${WEEKDAYS[index] ?? ''}: ${periodText(day)}`;
    column.append(el('span', 'done-col-value', String(day.deeds)), bar, el('span', 'done-col-label', WEEKDAYS[index] ?? ''));
    chart.append(column);
  });
  return chart;
}

function recentList(summary: StatsSummary): HTMLElement {
  const list = el('div', 'done-list');
  list.append(el('h2', 'done-subtitle', 'Последние дела'));
  if (summary.recent.length === 0) {
    list.append(el('div', 'empty', 'Пока ничего не сделано'));
    return list;
  }
  for (const deed of summary.recent) {
    const row = el('div', 'done-item');
    row.append(
      el('span', 'done-item-title', deed.title),
      el('span', 'done-item-meta', `${deed.minutes} мин`)
    );
    list.append(row);
  }
  return list;
}

export function mountDoneScreen(root: HTMLElement): DoneScreen {
  clear(root);
  const header = el('header', 'done-header');
  header.append(el('h1', 'done-title', 'Сделано'));
  const body = el('div', 'done-body');
  root.append(header, body);

  function render(summary: StatsSummary): void {
    clear(body);
    body.append(
      el('div', 'done-today', `Сегодня ${summary.today.deeds} дел и около ${summary.today.minutes} минут экономии`),
      el('div', 'done-subtitle', 'По дням недели'),
      weekdayChart(summary),
      el('div', 'done-week', `За неделю: ${periodText(summary.week)} · за всё время: ${periodText(summary.total)}`),
      recentList(summary)
    );
  }

  async function refresh(): Promise<void> {
    try {
      render(await window.tishka.stats.summary());
    } catch {
      clear(body);
      body.append(el('div', 'done-error', 'Не удалось загрузить счётчик'));
    }
  }

  window.tishka.onEvent((event) => {
    if (event.type === 'stats.changed') {
      void refresh();
    }
  });

  void refresh();
  return { refresh };
}
