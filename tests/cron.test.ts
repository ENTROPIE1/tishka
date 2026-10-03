import { describe, expect, it } from 'vitest';
import { cronMatches, parseCron } from '../src/core/triggers/cron';

function local(...parts: [number, number, number, number, number]): Date {
  const [year, month, day, hours, minutes] = parts;
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

describe('parseCron', () => {
  it('разбирает шаг и диапазоны: понедельник 09:30 подходит, суббота — нет', () => {
    const spec = parseCron('*/15 9-18 * * 1-5');

    expect(cronMatches(spec, local(2026, 10, 5, 9, 30))).toBe(true);
    expect(cronMatches(spec, local(2026, 10, 3, 10, 0))).toBe(false);
  });

  it('0 9 * * 5 совпадает только в пятницу в 09:00', () => {
    const spec = parseCron('0 9 * * 5');

    expect(cronMatches(spec, local(2026, 10, 2, 9, 0))).toBe(true);
    expect(cronMatches(spec, local(2026, 10, 2, 9, 1))).toBe(false);
    expect(cronMatches(spec, local(2026, 10, 5, 9, 0))).toBe(false);
  });

  it('считает и 0, и 7 воскресеньем', () => {
    const zero = parseCron('0 9 * * 0');
    const seven = parseCron('0 9 * * 7');

    expect(cronMatches(zero, local(2026, 10, 4, 9, 0))).toBe(true);
    expect(cronMatches(seven, local(2026, 10, 4, 9, 0))).toBe(true);
  });

  it('поддерживает списки значений', () => {
    const spec = parseCron('0,30 8,20 * * *');

    expect(cronMatches(spec, local(2026, 10, 5, 8, 0))).toBe(true);
    expect(cronMatches(spec, local(2026, 10, 5, 20, 30))).toBe(true);
    expect(cronMatches(spec, local(2026, 10, 5, 9, 0))).toBe(false);
  });

  it('бросает понятную ошибку на неверном выражении', () => {
    expect(() => parseCron('* * * *')).toThrow();
    expect(() => parseCron('60 * * * *')).toThrow();
    expect(() => parseCron('* 24 * * *')).toThrow();
    expect(() => parseCron('a b c d e')).toThrow();
    expect(() => parseCron('1-5/2 * * * *')).toThrow();
  });
});
