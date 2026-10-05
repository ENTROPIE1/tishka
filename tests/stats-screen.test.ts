// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { StatsSummary, TishkaEvent } from '../src/core/types';
import { mountStatsBlock } from '../src/renderer/chat/stats-block';
import { mountDoneScreen } from '../src/renderer/chat/done/screen';

type Listener = (event: TishkaEvent) => void;

function period(deeds: number, minutes: number): { deeds: number; minutes: number } {
  return { deeds, minutes };
}

function makeSummary(todayDeeds: number): StatsSummary {
  return {
    today: period(todayDeeds, todayDeeds * 5),
    week: period(7, 30),
    total: period(20, 90),
    bySkill: [{ skillId: 'report', name: 'Отчёт', deeds: 3, minutes: 15 }],
    byWeekday: [period(0, 0), period(1, 5), period(2, 10), period(0, 0), period(0, 0), period(0, 0), period(0, 0)],
    recent: [
      { id: 'd1', kind: 'draft', title: 'Черновик письма', at: '2026-10-06T10:00:00.000Z', minutes: 8 },
      { id: 'd2', kind: 'skill', title: 'Отчёт', at: '2026-10-06T09:00:00.000Z', minutes: 15 }
    ]
  };
}

let listener: Listener | undefined;
let current: StatsSummary;

function install(summary: StatsSummary): void {
  current = summary;
  listener = undefined;
  (window as unknown as { tishka: unknown }).tishka = {
    stats: { summary: async () => current },
    onEvent: (next: Listener) => {
      listener = next;
      return () => undefined;
    }
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve();
  }
}

afterEach(() => {
  document.body.replaceChildren();
  listener = undefined;
});

describe('mountStatsBlock', () => {
  it('показывает числа за сегодня и обновляется по событию', async () => {
    install(makeSummary(2));
    const root = document.createElement('div');
    document.body.append(root);

    mountStatsBlock(root);
    await flush();

    expect(root.hidden).toBe(false);
    expect(root.textContent).toContain('Сегодня Тишка сделал 2 дел и сберёг около 10 минут');

    current = makeSummary(4);
    listener?.({ type: 'stats.changed' });
    await flush();

    expect(root.textContent).toContain('сделал 4');
    expect(root.textContent).toContain('20 минут');
  });
});

describe('mountDoneScreen', () => {
  it('рисует дни недели и последние дела и пересчитывается', async () => {
    install(makeSummary(2));
    const root = document.createElement('section');
    document.body.append(root);

    mountDoneScreen(root);
    await flush();

    expect(root.querySelectorAll('.done-bar')).toHaveLength(7);
    expect(root.textContent).toContain('Черновик письма');
    expect(root.textContent).toContain('Отчёт');

    current = {
      ...makeSummary(4),
      recent: [{ id: 'd3', kind: 'page', title: 'Найдена страница', at: '2026-10-06T11:00:00.000Z', minutes: 3 }]
    };
    listener?.({ type: 'stats.changed' });
    await flush();

    expect(root.textContent).toContain('Найдена страница');
    expect(root.textContent).not.toContain('Черновик письма');
  });
});
