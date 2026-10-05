import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEventBus } from '../src/core/events';
import { createStatsRecorder } from '../src/core/stats/recorder';
import { createStatsStore, type StatsStore } from '../src/core/stats/store';
import { registerStatsTools } from '../src/core/stats/tool';
import { createToolRegistry } from '../src/core/tools/registry';
import type { StatsSummary, TishkaEvent, ToolResult } from '../src/core/types';

let dir: string;
let store: StatsStore;

function summary(overrides: Partial<StatsSummary> = {}): StatsSummary {
  const period = { deeds: 0, minutes: 0 };
  return {
    today: period,
    week: period,
    total: period,
    bySkill: [],
    byWeekday: [
      period, period, period, period, period, period, period
    ],
    recent: [],
    ...overrides
  };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tishka-stats-tool-'));
  store = createStatsStore({ filePath: join(dir, 'stats.json'), now: () => new Date('2026-10-05T10:00:00') });
  await store.load();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('createStatsRecorder', () => {
  it('завершённый инструмент становится делом и шлёт stats.changed', async () => {
    const bus = createEventBus();
    const events: TishkaEvent[] = [];
    bus.on((event) => events.push(event));
    const recorder = createStatsRecorder(store, bus);

    await recorder.fromTool('mail_draft_link', { ok: true, content: '' });

    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]).toMatchObject({ kind: 'draft', minutes: 8 });
    expect(events).toContainEqual({ type: 'stats.changed' });
  });

  it('неудачный вызов и неизвестный инструмент дело не создают', async () => {
    const recorder = createStatsRecorder(store, createEventBus());
    const failed: ToolResult = { ok: false, content: '', error: 'нет' };

    await recorder.fromTool('mail_draft_link', failed);
    await recorder.fromTool('какой-то инструмент', { ok: true, content: '' });

    expect(store.list()).toEqual([]);
  });
});

describe('createToolRegistry', () => {
  it('наблюдатель результата передаёт успешный вызов счётчику', async () => {
    const recorder = createStatsRecorder(store, createEventBus());
    const registry = createToolRegistry(createEventBus(), {
      onResult: (name, result) => recorder.fromTool(name, result)
    });
    registry.register(
      { name: 'search_pages', description: 'поиск', inputSchema: { type: 'object' }, source: 'builtin', readOnly: true },
      async () => ({ ok: true, content: 'нашёл' })
    );

    await registry.call('search_pages', {});

    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]).toMatchObject({ kind: 'page', minutes: 3 });
  });
});

describe('stats_summary', () => {
  it('отдаёт сводку текстом и карточкой', async () => {
    const registry = createToolRegistry(createEventBus());
    registerStatsTools(registry, {
      summary: () =>
        summary({
          today: { deeds: 2, minutes: 15 },
          bySkill: [{ skillId: 'report', name: 'Отчёт', deeds: 2, minutes: 15 }]
        })
    });

    const result = await registry.call('stats_summary', {});

    expect(result.ok).toBe(true);
    expect(result.content).toContain('Сегодня');
    expect(result.reply?.say).toContain('2');
    const panel = result.reply?.show;
    expect(panel?.kind === 'text' ? panel.markdown : '').toContain('Отчёт');
  });

  it('пустой день отвечает «ничего не делал»', async () => {
    const registry = createToolRegistry(createEventBus());
    registerStatsTools(registry, { summary: () => summary() });

    const result = await registry.call('stats_summary', {});

    expect(result.ok).toBe(true);
    expect(result.reply?.say).toBe('Сегодня я пока ничего не делал');
  });
});
