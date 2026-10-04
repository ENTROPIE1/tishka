import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryStore, type MemoryStore } from '../src/core/memory/store';

const DAY_MS = 24 * 60 * 60 * 1000;

let dir: string;
let now: Date;

function makeStore(): MemoryStore {
  return createMemoryStore({ filePath: join(dir, 'memory.json'), now: () => now });
}

function plusDays(days: number): void {
  now = new Date(now.getTime() + days * DAY_MS);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tishka-memory-'));
  now = new Date('2026-01-01T10:00:00.000Z');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('createMemoryStore', () => {
  it('add, update, remove, list переживают пересоздание хранилища', async () => {
    const first = makeStore();
    const anna = await first.add({ text: 'Аня Петрова, тестирование', tags: ['почта'] });
    await first.add({ text: 'Борис Ильин, аналитика', tags: ['почта'] });

    const second = makeStore();
    await second.load();
    expect(second.list()).toHaveLength(2);

    await second.update(anna.id, { text: 'Аня Петрова, тестирование — anna@example.ru' });
    await second.remove(second.list()[1].id);

    const third = makeStore();
    await third.load();
    expect(third.list()).toHaveLength(1);
    expect(third.list()[0].text).toContain('anna@example.ru');
  });

  it('почти одинаковый текст не создаёт дубль, а обновляет updated', async () => {
    const store = makeStore();
    const first = await store.add({ text: 'Аня, почта!' });
    now = new Date(now.getTime() + 60_000);
    const again = await store.add({ text: 'аня почта' });

    expect(store.list()).toHaveLength(1);
    expect(again.id).toBe(first.id);
    expect(again.updated).toBe(now.toISOString());
    expect(again.created).toBe(first.created);
  });

  it('запись с reviewDays: 90 попадает в due через 91 день, после confirm — нет', async () => {
    const store = makeStore();
    const record = await store.add({ text: 'Адрес Ани', reviewDays: 90 });

    plusDays(89);
    expect(store.due()).toEqual([]);

    plusDays(2);
    expect(store.due().map((item) => item.id)).toEqual([record.id]);

    await store.confirm(record.id);
    expect(store.due()).toEqual([]);

    plusDays(90);
    expect(store.due().map((item) => item.id)).toEqual([record.id]);
  });

  it('текст длиннее 500 символов — ошибка', async () => {
    const store = makeStore();
    await expect(store.add({ text: 'х'.repeat(501) })).rejects.toThrow();
  });

  it('update с reviewDays: null убирает дату проверки', async () => {
    const store = makeStore();
    const record = await store.add({ text: 'Предпочтение', reviewDays: 30 });
    await store.update(record.id, { reviewDays: null });

    plusDays(40);
    expect(store.due()).toEqual([]);
    expect(store.list()[0].reviewAt).toBeUndefined();
  });

  it('clear очищает все записи', async () => {
    const store = makeStore();
    await store.add({ text: 'Первая' });
    await store.add({ text: 'Вторая' });

    await store.clear();

    expect(store.list()).toEqual([]);
    const recreated = makeStore();
    await recreated.load();
    expect(recreated.list()).toEqual([]);
  });
});
