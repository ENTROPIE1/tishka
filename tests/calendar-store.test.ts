import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCalendarStore, type CalendarStore } from '../src/core/calendar/store';

let dir: string;
let now: Date;

function makeStore(mark?: ReturnType<typeof vi.fn>): CalendarStore {
  return createCalendarStore({
    filePath: join(dir, 'calendar.json'),
    now: () => now,
    mark: mark as never
  });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tishka-calendar-'));
  now = new Date('2026-10-07T10:00:00+03:00');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('createCalendarStore', () => {
  it('добавляет, меняет и удаляет события, переживая пересоздание хранилища', async () => {
    const first = makeStore();
    await first.load();
    const demo = await first.add({ title: 'Демо', start: '2026-10-07T14:00:00+03:00', end: '2026-10-07T15:00:00+03:00' });

    const second = makeStore();
    await second.load();
    expect(second.all()).toHaveLength(1);

    await second.update(demo.id, { title: 'Демо 2', remindMinutes: 5 });
    const third = makeStore();
    await third.load();
    expect(third.find(demo.id)?.title).toBe('Демо 2');
    expect(third.find(demo.id)?.remindMinutes).toBe(5);

    await third.remove(demo.id);
    const fourth = makeStore();
    await fourth.load();
    expect(fourth.all()).toHaveLength(0);
  });

  it('находит пересечения и исключает само событие', async () => {
    const store = makeStore();
    await store.load();
    const meeting = await store.add({
      title: 'Планёрка',
      start: '2026-10-07T11:00:00+03:00',
      end: '2026-10-07T12:00:00+03:00'
    });

    expect(store.overlaps('2026-10-07T11:30:00+03:00', '2026-10-07T12:30:00+03:00')).toHaveLength(1);
    expect(store.overlaps('2026-10-07T12:00:00+03:00', '2026-10-07T13:00:00+03:00')).toHaveLength(0);
    expect(store.overlaps('2026-10-07T11:00:00+03:00', '2026-10-07T12:00:00+03:00', meeting.id)).toHaveLength(0);
  });

  it('список за период возвращает только пересекающиеся события по порядку', async () => {
    const store = makeStore();
    await store.load();
    await store.add({ title: 'Позже', start: '2026-10-08T10:00:00+03:00', end: '2026-10-08T11:00:00+03:00' });
    await store.add({ title: 'Сегодня', start: '2026-10-07T10:00:00+03:00', end: '2026-10-07T11:00:00+03:00' });

    const list = store.list({ from: '2026-10-07T00:00:00+03:00', to: '2026-10-08T00:00:00+03:00' });
    expect(list.map((event) => event.title)).toEqual(['Сегодня']);
  });

  it('повреждённый файл даёт пустой календарь и строку в журнале', async () => {
    await writeFile(join(dir, 'calendar.json'), '{ это не json', 'utf8');
    const mark = vi.fn();
    const store = makeStore(mark);
    await store.load();
    expect(store.all()).toEqual([]);
    expect(mark).toHaveBeenCalledWith('calendar.corrupt', expect.anything());
  });

  it('загруженное событие правится только по напоминанию и заметке и не удаляется', async () => {
    const store = makeStore();
    await store.load();
    await store.add({
      title: 'Из почты',
      start: '2026-10-07T14:00:00+03:00',
      end: '2026-10-07T15:00:00+03:00',
      source: 'exchange:работа',
      externalId: 'ext-1'
    });
    const loaded = store.all()[0];

    const updated = await store.update(loaded.id, { title: 'Другое', note: 'важно', remindMinutes: 15 });
    expect(updated?.title).toBe('Из почты');
    expect(updated?.note).toBe('важно');
    expect(updated?.remindMinutes).toBe(15);
    await expect(store.remove(loaded.id)).resolves.toBe(false);
  });

  it('событие расписания не правится и не удаляется', async () => {
    const store = makeStore();
    await store.load();
    const added = await store.add({
      title: 'Позвонить',
      start: '2026-10-07T16:00:00+03:00',
      end: '2026-10-07T16:15:00+03:00',
      source: 'schedule',
      kind: 'reminder'
    });

    await expect(store.update(added.id, { title: 'Другое' })).resolves.toBeUndefined();
    await expect(store.remove(added.id)).resolves.toBe(false);
    expect(store.all()).toHaveLength(1);
  });

  it('replacestSource убирает исчезнувшие загруженные события', async () => {
    const store = makeStore();
    await store.load();
    await store.replaceSource('exchange:работа', [
      { title: 'A', start: '2026-10-07T14:00:00+03:00', end: '2026-10-07T15:00:00+03:00', externalId: 'a' },
      { title: 'B', start: '2026-10-07T16:00:00+03:00', end: '2026-10-07T17:00:00+03:00', externalId: 'b' }
    ]);
    expect(store.all()).toHaveLength(2);

    await store.replaceSource('exchange:работа', [
      { title: 'A', start: '2026-10-07T14:00:00+03:00', end: '2026-10-07T15:00:00+03:00', externalId: 'a' }
    ]);
    expect(store.all().map((event) => event.title)).toEqual(['A']);
  });
});
