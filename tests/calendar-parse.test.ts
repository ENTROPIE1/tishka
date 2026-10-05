import { describe, expect, it } from 'vitest';
import { parseWhen } from '../src/core/calendar/parse';

const NOW = new Date('2026-10-07T10:00:00');

function at(iso: string): number {
  return new Date(iso).getTime();
}

describe('parseWhen', () => {
  it('разбирает «завтра в 15»', () => {
    const parsed = parseWhen('завтра в 15', NOW);
    expect(parsed?.allDay).toBe(false);
    expect(new Date(parsed!.start).getTime()).toBe(at('2026-10-08T15:00:00'));
  });

  it('разбирает «в пятницу с 10 до 11»', () => {
    const parsed = parseWhen('в пятницу с 10 до 11', NOW);
    expect(new Date(parsed!.start).getTime()).toBe(at('2026-10-09T10:00:00'));
    expect(new Date(parsed!.end!).getTime()).toBe(at('2026-10-09T11:00:00'));
  });

  it('разбирает «через час на 30 минут»', () => {
    const parsed = parseWhen('через час на 30 минут', NOW);
    expect(new Date(parsed!.start).getTime()).toBe(at('2026-10-07T11:00:00'));
    expect(parsed?.durationMinutes).toBe(30);
    expect(new Date(parsed!.end!).getTime()).toBe(at('2026-10-07T11:30:00'));
  });

  it('разбирает «сегодня в 18:00»', () => {
    const parsed = parseWhen('сегодня в 18:00', NOW);
    expect(new Date(parsed!.start).getTime()).toBe(at('2026-10-07T18:00:00'));
  });

  it('разбирает «через 2 часа»', () => {
    const parsed = parseWhen('через 2 часа', NOW);
    expect(new Date(parsed!.start).getTime()).toBe(at('2026-10-07T12:00:00'));
  });

  it('прошедшее время без дня переносится на завтра', () => {
    const parsed = parseWhen('в 9', NOW);
    expect(new Date(parsed!.start).getTime()).toBe(at('2026-10-08T09:00:00'));
  });

  it('день без времени — событие на весь день', () => {
    const parsed = parseWhen('завтра', NOW);
    expect(parsed?.allDay).toBe(true);
    expect(new Date(parsed!.start).getTime()).toBe(at('2026-10-08T00:00:00'));
    expect(new Date(parsed!.end!).getTime()).toBe(at('2026-10-09T00:00:00'));
  });

  it('непонятный текст не разбирается', () => {
    expect(parseWhen('подумать об этом', NOW)).toBeUndefined();
  });
});
