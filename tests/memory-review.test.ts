import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEventBus } from '../src/core/events';
import { createMemoryReviewer } from '../src/core/memory/review';
import { createMemoryStore, type MemoryStore } from '../src/core/memory/store';
import type { Panel, TishkaEvent } from '../src/core/types';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

let dir: string;
let store: MemoryStore;
let now: Date;
let events: TishkaEvent[];
let reviewer: ReturnType<typeof createMemoryReviewer>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tishka-memory-review-'));
  now = new Date('2026-01-01T10:00:00.000Z');
  store = createMemoryStore({ filePath: join(dir, 'memory.json'), now: () => now });
  await store.load();
  const bus = createEventBus();
  events = [];
  bus.on((event) => events.push(event));
  reviewer = createMemoryReviewer({ store, events: bus, now: () => now });
});

afterEach(async () => {
  reviewer.stop();
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

function notifies(): TishkaEvent[] {
  return events.filter((event) => event.type === 'notify');
}

function lastPanel(): Panel | undefined {
  const reply = events.filter((event) => event.type === 'reply').at(-1);
  return reply?.type === 'reply' ? reply.reply.show : undefined;
}

describe('createMemoryReviewer', () => {
  it('одна реплика notify в сутки и не больше 10 записей в карточке', async () => {
    for (let index = 0; index < 12; index += 1) {
      await store.add({ text: `Адрес ${index}`, reviewDays: 1 });
    }
    now = new Date(now.getTime() + 2 * DAY_MS);

    await reviewer.tick();
    expect(notifies()).toHaveLength(1);
    const panel = lastPanel();
    expect(panel?.kind).toBe('list');
    if (panel?.kind === 'list') {
      expect(panel.items).toHaveLength(10);
    }

    now = new Date(now.getTime() + HOUR_MS);
    await reviewer.tick();
    expect(notifies()).toHaveLength(1);

    now = new Date(now.getTime() + 25 * HOUR_MS);
    await reviewer.tick();
    expect(notifies()).toHaveLength(2);
  });

  it('без записей к проверке реплики нет', async () => {
    await store.add({ text: 'Предпочтение без срока' });

    await reviewer.tick();

    expect(notifies()).toEqual([]);
  });
});
