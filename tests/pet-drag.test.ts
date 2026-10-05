// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDrag, DRAG_IDLE_MS, type DragController } from '../src/renderer/pet/drag';

interface Log {
  begins: number;
  moves: number[];
  ends: number;
  clicks: number;
}

let drag: DragController | undefined;

function harness(): { drag: DragController; log: Log } {
  const log: Log = { begins: 0, moves: [], ends: 0, clicks: 0 };
  drag = createDrag({
    onBegin: () => {
      log.begins += 1;
    },
    onMove: (delta) => log.moves.push(delta),
    onEnd: () => {
      log.ends += 1;
    },
    onClick: () => {
      log.clicks += 1;
    }
  });
  return { drag, log };
}

afterEach(() => {
  drag?.dispose();
  drag = undefined;
  vi.useRealTimers();
});

describe('перетаскивание ежа: конец всегда наступает', () => {
  it('отпускание без движения — щелчок', () => {
    const { drag: d, log } = harness();
    d.down(100, 0);
    d.up();
    expect(log).toEqual({ begins: 1, moves: [], ends: 1, clicks: 1 });
  });

  it('движение сдвигает окно, а не открывает строку ввода', () => {
    const { drag: d, log } = harness();
    d.down(100, 0);
    d.move(140);
    d.up();
    expect(log.begins).toBe(1);
    expect(log.moves).toEqual([40]);
    expect(log.ends).toBe(1);
    expect(log.clicks).toBe(0);
  });

  it('правая кнопка перетаскивание не начинает', () => {
    const { drag: d, log } = harness();
    d.down(100, 2);
    d.move(200);
    d.up();
    expect(log).toEqual({ begins: 0, moves: [], ends: 0, clicks: 0 });
  });

  it('отмена указателя завершает перетаскивание без щелчка', () => {
    const { drag: d, log } = harness();
    d.down(100, 0);
    d.move(140);
    d.cancel();
    expect(log.ends).toBe(1);
    expect(log.clicks).toBe(0);
  });

  it('событие отпускания после отмены ничего не повторяет', () => {
    const { drag: d, log } = harness();
    d.down(100, 0);
    d.cancel();
    d.up();
    expect(log.ends).toBe(1);
  });

  it('без движения перетаскивание кончается само через срок простоя', () => {
    vi.useFakeTimers();
    const { drag: d, log } = harness();
    d.down(100, 0);

    vi.advanceTimersByTime(DRAG_IDLE_MS - 1);
    expect(log.ends).toBe(0);

    vi.advanceTimersByTime(1);
    expect(log.ends).toBe(1);
    // Конец по простою — не щелчок: строку ввода не открываем.
    expect(log.clicks).toBe(0);
  });

  it('движение продлевает перетаскивание, простой считается заново', () => {
    vi.useFakeTimers();
    const { drag: d, log } = harness();
    d.down(100, 0);

    vi.advanceTimersByTime(DRAG_IDLE_MS - 1000);
    d.move(140);
    vi.advanceTimersByTime(DRAG_IDLE_MS - 1000);
    expect(log.ends).toBe(0);

    vi.advanceTimersByTime(1000);
    expect(log.ends).toBe(1);
  });

  it('прямая отмена по потере фокуса завершает перетаскивание', () => {
    const { drag: d, log } = harness();
    d.down(100, 0);
    d.cancel();
    expect(log.ends).toBe(1);
    expect(log.clicks).toBe(0);
  });
});
