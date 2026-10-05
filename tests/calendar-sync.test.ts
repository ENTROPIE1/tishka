import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultCalendarConfig } from '../src/core/calendar/types';
import { cleanup, harness, meeting } from './calendar-sync-helpers';

afterEach(() => {
  vi.useRealTimers();
});

describe('createCalendarSync: слияние встреч', () => {
  it('первая загрузка добавляет встречу с полями события', async () => {
    const h = await harness([meeting()]);
    try {
      const result = await h.sync.sync();
      expect(result).toMatchObject({ ok: true, added: 1, updated: 0, removed: 0 });
      const events = h.store.all();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        title: 'Планёрка',
        source: 'exchange:work',
        externalId: 'm1',
        kind: 'meeting',
        location: 'Переговорка 1',
        link: 'https://meet.example/abc',
        remindMinutes: defaultCalendarConfig().defaultRemindMinutes
      });
      expect(h.changes).toBe(1);
    } finally {
      await cleanup(h);
    }
  });

  it('изменение времени встречи обновляет событие', async () => {
    const h = await harness([meeting()]);
    try {
      await h.sync.sync();
      h.meetings = [meeting({ start: '2026-10-07T13:00:00.000Z', end: '2026-10-07T14:00:00.000Z' })];
      const result = await h.sync.sync();
      expect(result).toMatchObject({ added: 0, updated: 1, removed: 0 });
      expect(h.store.all()[0].start).toBe('2026-10-07T13:00:00.000Z');
    } finally {
      await cleanup(h);
    }
  });

  it('отменённая встреча убирается из календаря', async () => {
    const h = await harness([meeting()]);
    try {
      await h.sync.sync();
      h.meetings = [meeting({ cancelled: true })];
      const result = await h.sync.sync();
      expect(result).toMatchObject({ added: 0, updated: 0, removed: 1 });
      expect(h.store.all()).toHaveLength(0);
    } finally {
      await cleanup(h);
    }
  });

  it('исчезнувшая встреча убирается из календаря', async () => {
    const h = await harness([meeting()]);
    try {
      await h.sync.sync();
      h.meetings = [];
      const result = await h.sync.sync();
      expect(result).toMatchObject({ removed: 1 });
      expect(h.store.all()).toHaveLength(0);
    } finally {
      await cleanup(h);
    }
  });

  it('сохраняет заметку и напоминание человека при изменении встречи', async () => {
    const h = await harness([meeting()]);
    try {
      await h.sync.sync();
      const event = h.store.all()[0];
      await h.store.update(event.id, { note: 'взять отчёт', remindMinutes: 5 });
      h.meetings = [meeting({ subject: 'Планёрка новая', start: '2026-10-07T13:00:00.000Z' })];
      await h.sync.sync();
      const updated = h.store.all()[0];
      expect(updated.title).toBe('Планёрка новая');
      expect(updated.note).toBe('взять отчёт');
      expect(updated.remindMinutes).toBe(5);
    } finally {
      await cleanup(h);
    }
  });

  it('две загрузки подряд без изменений ничего не меняют и не шлют событий', async () => {
    const h = await harness([meeting()]);
    try {
      await h.sync.sync();
      expect(h.changes).toBe(1);
      const result = await h.sync.sync();
      expect(result).toMatchObject({ ok: true, added: 0, updated: 0, removed: 0 });
      expect(h.changes).toBe(1);
    } finally {
      await cleanup(h);
    }
  });

  it('ошибка подключения не роняет синхронизацию и сохраняет время последней удачи', async () => {
    const h = await harness([meeting()]);
    try {
      await h.sync.sync();
      const loadedAt = h.sync.state()['work'].loadedAt;
      expect(loadedAt).toBeDefined();

      h.fail = 'Почтовый сервер недоступен';
      const result = await h.sync.sync();
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Почтовый сервер недоступен');
      expect(h.sync.state()['work']).toMatchObject({
        ok: false,
        error: 'Почтовый сервер недоступен',
        loadedAt
      });
    } finally {
      await cleanup(h);
    }
  });

  it('выключенный источник не загружается', async () => {
    const h = await harness([meeting()], { work: false });
    try {
      const result = await h.sync.sync();
      expect(result).toMatchObject({ ok: true, added: 0, updated: 0, removed: 0 });
      expect(h.calls).toBe(0);
    } finally {
      await cleanup(h);
    }
  });
});
