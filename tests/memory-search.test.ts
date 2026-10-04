import { describe, expect, it } from 'vitest';
import { searchRecords, type SearchRecord } from '../src/core/memory/search';

function make(overrides: Partial<SearchRecord> & { id: string }): SearchRecord {
  return {
    text: '',
    tags: [],
    updated: '2026-10-01T10:00:00.000Z',
    ...overrides
  };
}

const anna = make({
  id: 'anna',
  text: 'Аня Петрова, тестирование — anna@example.ru',
  tags: ['почта', 'команда'],
  updated: '2026-10-02T10:00:00.000Z'
});

describe('searchRecords', () => {
  it('находит запись по «письмо Ане из тестирования»', () => {
    const found = searchRecords([anna], 'письмо Ане из тестирования');
    expect(found.map((record) => record.id)).toEqual(['anna']);
  });

  it('находит запись по «почта Петровой»', () => {
    const found = searchRecords([anna], 'почта Петровой');
    expect(found.map((record) => record.id)).toEqual(['anna']);
  });

  it('не находит запись по «расписание встреч»', () => {
    expect(searchRecords([anna], 'расписание встреч')).toEqual([]);
  });

  it('совпадение с меткой весит вдвое и поднимает запись выше', () => {
    const byText = make({ id: 'text', text: 'почта команды' });
    const byTag = make({ id: 'tag', text: 'заметка', tags: ['почта'] });

    const found = searchRecords([byText, byTag], 'почта');

    expect(found.map((record) => record.id)).toEqual(['tag', 'text']);
  });

  it('при равной оценке выше более свежая запись', () => {
    const older = make({ id: 'older', text: 'адрес Ани', updated: '2026-01-01T00:00:00.000Z' });
    const newer = make({ id: 'newer', text: 'адрес Ани', updated: '2026-09-01T00:00:00.000Z' });

    const found = searchRecords([older, newer], 'адрес Ани');

    expect(found.map((record) => record.id)).toEqual(['newer', 'older']);
  });

  it('записи с нулевой оценкой не возвращаются и соблюдается предел', () => {
    const records = [
      make({ id: 'a', text: 'адрес Ани' }),
      make({ id: 'b', text: 'адрес Ани' }),
      make({ id: 'c', text: 'адрес Ани' })
    ];

    expect(searchRecords(records, 'адрес Ани', 2)).toHaveLength(2);
    expect(searchRecords(records, 'для или это')).toEqual([]);
  });
});
