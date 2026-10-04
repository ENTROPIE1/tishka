import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEventBus } from '../src/core/events';
import { createMemoryStore, type MemoryStore } from '../src/core/memory/store';
import { registerMemoryTools } from '../src/core/memory/tools';
import { createToolRegistry } from '../src/core/tools/registry';
import type { ToolRegistry } from '../src/core/types';

let dir: string;
let store: MemoryStore;
let registry: ToolRegistry;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tishka-memory-tools-'));
  store = createMemoryStore({ filePath: join(dir, 'memory.json'), now: () => new Date('2026-01-01T10:00:00.000Z') });
  await store.load();
  registry = createToolRegistry(createEventBus());
  registerMemoryTools(registry, store);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('registerMemoryTools', () => {
  it('memory_save с тремя записями добавляет три записи', async () => {
    const result = await registry.call('memory_save', {
      items: [
        { text: 'Аня Петрова, тестирование, anna@example.ru', tags: ['почта'] },
        { text: 'Борис Ильин, аналитика, boris@example.ru', tags: ['почта'] },
        { text: 'Ссылка на базу знаний: https://example.org/wiki' }
      ]
    });

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ added: 3, updated: 0 });
    expect(store.list()).toHaveLength(3);
  });

  it('текст длиннее предела — ошибка для этой записи, остальные сохраняются', async () => {
    const result = await registry.call('memory_save', {
      items: [
        { text: 'Нормальная запись' },
        { text: 'х'.repeat(501) },
        { text: 'Ещё одна запись' }
      ]
    });

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ added: 2 });
    expect(store.list()).toHaveLength(2);
    expect(result.content).toContain('Не сохранено');
  });

  it('memory_search находит запись по смыслу', async () => {
    await registry.call('memory_save', {
      items: [{ text: 'Аня Петрова, тестирование, anna@example.ru', tags: ['почта', 'команда'] }]
    });

    const result = await registry.call('memory_search', { query: 'почта Петровой' });

    expect(result.ok).toBe(true);
    expect(result.content).toContain('anna@example.ru');
  });

  it('memory_update, memory_forget и memory_confirm работают по идентификатору', async () => {
    const saved = await registry.call('memory_save', { items: [{ text: 'Адрес офиса' }] });
    expect(saved.ok).toBe(true);
    const record = store.list()[0];

    const updated = await registry.call('memory_update', { id: record.id, text: 'Адрес нового офиса' });
    expect(updated.ok).toBe(true);
    expect(store.list()[0].text).toBe('Адрес нового офиса');

    const confirmed = await registry.call('memory_confirm', { ids: [record.id] });
    expect(confirmed.data).toMatchObject({ confirmed: 1 });

    const forgotten = await registry.call('memory_forget', { id: record.id });
    expect(forgotten.ok).toBe(true);
    expect(store.list()).toEqual([]);
  });
});
