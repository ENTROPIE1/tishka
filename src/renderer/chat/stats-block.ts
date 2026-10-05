export interface StatsBlock {
  refresh(): Promise<void>;
}

// Блок на главном экране чата: сколько дел Тишка сделал за сегодня.
export function mountStatsBlock(root: HTMLElement): StatsBlock {
  async function refresh(): Promise<void> {
    try {
      const summary = await window.tishka.stats.summary();
      root.textContent = `Сегодня Тишка сделал ${summary.today.deeds} дел и сберёг около ${summary.today.minutes} минут`;
      root.hidden = false;
    } catch {
      root.hidden = true;
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
