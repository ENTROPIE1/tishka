import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateSkill } from '../src/core/skills/validate';
import { createStatsStore, type StatsStore } from '../src/core/stats/store';
import type { DeedKind } from '../src/core/types';

let dir: string;
let filePath: string;
let now: Date;

function makeStore(): StatsStore {
  return createStatsStore({ filePath, now: () => now });
}

function skillWithMinutes(minutes?: number): number | undefined {
  const result = validateSkill({
    format: 'tishka-skill/1',
    id: 'skill-1',
    name: 'Навык',
    description: '',
    phrases: ['навык'],
    trigger: { type: 'manual' },
    steps: [{ id: 'a', say: 'Готово' }],
    ...(minutes === undefined ? {} : { manualMinutes: minutes })
  });
  if (!result.ok) {
    throw new Error(result.errors.join('; '));
  }
  return result.skill.manualMinutes;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tishka-stats-'));
  filePath = join(dir, 'stats.json');
  now = new Date(2026, 9, 5, 10, 0, 0);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe('createStatsStore', () => {
  it('учитывает каждый вид дела со своей оценкой минут', async () => {
    const store = makeStore();
    const expected: Array<[DeedKind, number]> = [
      ['skill', 5],
      ['automation', 5],
      ['draft', 8],
      ['event', 5],
      ['page', 3],
      ['reminder', 1]
    ];

    for (const [kind] of expected) {
      await store.record({ kind, title: kind });
    }

    const kinds = store.list().map((deed) => [deed.kind, deed.minutes]);
    expect(kinds).toEqual(expected);
  });

  it('минуты навыка берутся из карточки, иначе оценка по умолчанию', async () => {
    const store = makeStore();
    const manual = skillWithMinutes(25);
    expect(manual).toBe(25);
    expect(skillWithMinutes()).toBeUndefined();

    const withCard = await store.record({ kind: 'skill', title: 'Навык', minutes: manual });
    const withoutCard = await store.record({ kind: 'skill', title: 'Навык' });

    expect(withCard.minutes).toBe(25);
    expect(withoutCard.minutes).toBe(5);
  });

  it('сводка считает сегодня, неделю и всё время с разбивкой по навыкам и дням', async () => {
    const store = makeStore();
    await store.record({ kind: 'skill', title: 'Отчёт', skillId: 'report', minutes: 20 });
    await store.record({ kind: 'reminder', title: 'Позвонить' });

    now = new Date(2026, 9, 6, 11, 0, 0);
    await store.record({ kind: 'draft', title: 'Письмо' });

    const summary = store.summary();
    expect(summary.today).toEqual({ deeds: 1, minutes: 8 });
    expect(summary.week).toEqual({ deeds: 3, minutes: 29 });
    expect(summary.total).toEqual({ deeds: 3, minutes: 29 });
    expect(summary.bySkill).toEqual([{ skillId: 'report', name: 'Отчёт', deeds: 1, minutes: 20 }]);
    expect(summary.byWeekday[0]).toEqual({ deeds: 2, minutes: 21 });
    expect(summary.byWeekday[1]).toEqual({ deeds: 1, minutes: 8 });
    expect(summary.byWeekday[2]).toEqual({ deeds: 0, minutes: 0 });
    expect(summary.recent[0].title).toBe('Письмо');
  });

  it('прошлая неделя не попадает в сегодня и в текущую неделю', async () => {
    const store = makeStore();
    await store.record({ kind: 'page', title: 'Страница' });

    now = new Date(2026, 9, 12, 10, 0, 0);
    const summary = store.summary();
    expect(summary.today).toEqual({ deeds: 0, minutes: 0 });
    expect(summary.week).toEqual({ deeds: 0, minutes: 0 });
    expect(summary.total).toEqual({ deeds: 1, minutes: 3 });
  });

  it('дела переживают пересоздание хранилища, запись атомарная', async () => {
    const store = makeStore();
    await store.record({ kind: 'event', title: 'Встреча' });

    const recreated = makeStore();
    await recreated.load();
    expect(recreated.list()).toHaveLength(1);
    expect(recreated.list()[0].title).toBe('Встреча');

    const temporary = JSON.parse(await readFile(filePath, 'utf8')) as { deeds: unknown[] };
    expect(temporary.deeds).toHaveLength(1);
    await expect(readFile(`${filePath}.tmp`, 'utf8')).rejects.toThrow();
  });

  it('повреждённый файл читается как пустой и не роняет ядро', async () => {
    await writeFile(filePath, '{ это не json', 'utf8');
    const broken = makeStore();
    await broken.load();
    expect(broken.list()).toEqual([]);
    expect(broken.summary().total).toEqual({ deeds: 0, minutes: 0 });
  });

  it('в чужом формате берёт только корректные дела', async () => {
    await writeFile(
      filePath,
      JSON.stringify({ deeds: [{ kind: 'bogus', title: 'нет' }, { kind: 'skill', title: 'есть', at: '2026-10-05T10:00:00.000Z', minutes: 7 }] }),
      'utf8'
    );
    const store = makeStore();
    await store.load();
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0].title).toBe('есть');
  });
});
