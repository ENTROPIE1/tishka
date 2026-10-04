import { describe, expect, it, vi } from 'vitest';
import { createEventBus } from '../src/core/events';
import type { HistoryEntry } from '../src/core/history';
import {
  HISTORY_MESSAGE_MAX,
  HISTORY_TOOL_DEFAULT_LIMIT,
  registerHistoryTools,
  type HistorySearcher
} from '../src/core/history-tool';
import { createToolRegistry } from '../src/core/tools/registry';

function message(id: string, text: string): HistoryEntry {
  return { kind: 'message', id, at: '2026-10-02T10:00:00.000Z', from: 'user', text };
}

function makeSearcher(found: HistoryEntry[]): HistorySearcher & { calls: Array<{ query: string; limit?: number }> } {
  const calls: Array<{ query: string; limit?: number }> = [];
  return {
    calls,
    search(query: string, limit?: number): HistoryEntry[] {
      calls.push({ query, limit });
      return found;
    }
  };
}

describe('history_search', () => {
  it('обрезает длинные реплики, оставляя пометку', async () => {
    const registry = createToolRegistry(createEventBus());
    const long = 'а'.repeat(2000);
    registerHistoryTools(registry, makeSearcher([message('id-1', long)]));

    const result = await registry.call('history_search', { query: 'а' });

    expect(result.ok).toBe(true);
    expect(result.content.length).toBeLessThanOrEqual(HISTORY_MESSAGE_MAX + 100);
    expect(result.content).toContain('…');
    expect(result.content).toContain('2026');
  });

  it('по умолчанию просит не больше десяти реплик', async () => {
    const registry = createToolRegistry(createEventBus());
    const searcher = makeSearcher([message('id-1', 'текст')]);
    registerHistoryTools(registry, searcher);

    await registry.call('history_search', { query: 'текст' });

    expect(searcher.calls).toEqual([{ query: 'текст', limit: HISTORY_TOOL_DEFAULT_LIMIT }]);
  });

  it('пустой запрос — ошибка', async () => {
    const registry = createToolRegistry(createEventBus());
    registerHistoryTools(registry, { search: vi.fn(() => []) });

    await expect(registry.call('history_search', { query: '  ' })).resolves.toMatchObject({ ok: false });
  });
});
