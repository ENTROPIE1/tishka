import { describe, expect, it } from 'vitest';
import { createBusyIntervals } from '../src/voice/busy-intervals';

function rig(): { clock: ReturnType<typeof createBusyIntervals>; setNow: (value: number) => void } {
  let current = 0;
  return {
    clock: createBusyIntervals({ now: () => current }),
    setNow: (value) => {
      current = value;
    }
  };
}

describe('createBusyIntervals', () => {
  it('помнит один отрезок занятости', () => {
    const { clock } = rig();
    clock.begin('thinking', 100);
    clock.finish(200);
    expect(clock.list()).toEqual([{ start: 100, end: 200, reason: 'thinking' }]);
  });

  it('склеивает два отрезка с промежутком меньше 1,5 с', () => {
    const { clock } = rig();
    clock.begin('thinking', 100);
    clock.finish(200);
    clock.begin('speech', 1200);
    clock.finish(1300);
    expect(clock.list()).toEqual([{ start: 100, end: 1300, reason: 'thinking' }]);
  });

  it('не склеивает два отрезка с большим промежутком', () => {
    const { clock } = rig();
    clock.begin('thinking', 100);
    clock.finish(200);
    clock.begin('speech', 5000);
    clock.finish(5100);
    expect(clock.list()).toEqual([
      { start: 100, end: 200, reason: 'thinking' },
      { start: 5000, end: 5100, reason: 'speech' }
    ]);
  });

  it('удаляет отрезки старше двух минут', () => {
    const { clock, setNow } = rig();
    clock.begin('work', 1000);
    clock.finish(2000);
    clock.begin('work', 150_000);
    clock.finish(151_000);
    setNow(152_000);
    expect(clock.list()).toEqual([{ start: 150_000, end: 151_000, reason: 'work' }]);
  });

  it('уточняет причину уже открытого отрезка', () => {
    const { clock } = rig();
    clock.begin('thinking', 100);
    clock.begin('speech', 150);
    clock.finish(200);
    expect(clock.list()).toEqual([{ start: 100, end: 200, reason: 'speech' }]);
  });

  it('запись до, во время и после занятости', () => {
    const { clock } = rig();
    clock.begin('work', 1000);
    clock.finish(2000);
    expect(clock.intersects(500)).toBe(false);
    expect(clock.intersects(1500)).toBe(true);
    expect(clock.intersects(2000)).toBe(false);
    expect(clock.intersects(2500)).toBe(false);
  });

  it('запись во время ещё открытой занятости пересекается', () => {
    const { clock } = rig();
    clock.begin('speech', 1000);
    expect(clock.intersects(500)).toBe(false);
    expect(clock.intersects(1500)).toBe(true);
  });

  it('clear забывает всё', () => {
    const { clock } = rig();
    clock.begin('thinking', 100);
    clock.finish(200);
    clock.clear();
    expect(clock.list()).toEqual([]);
    expect(clock.intersects(150)).toBe(false);
  });
});
