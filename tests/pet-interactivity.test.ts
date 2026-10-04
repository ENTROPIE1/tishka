import { describe, expect, it, vi } from 'vitest';
import { createInteractivity } from '../src/renderer/pet/interactivity';

describe('createInteractivity', () => {
  it('пересчёт по курсору над полем включает интерактивность', () => {
    const setInteractive = vi.fn<(value: boolean) => void>();
    const interactivity = createInteractivity({
      isVisible: () => true,
      hitTest: (x, y) => x === 10 && y === 20,
      setInteractive
    });

    interactivity.recalc({ x: 10, y: 20 });

    expect(setInteractive).toHaveBeenCalledWith(true);
  });

  it('повторный пересчёт с тем же результатом не дёргает окно', () => {
    const setInteractive = vi.fn<(value: boolean) => void>();
    const interactivity = createInteractivity({
      isVisible: () => true,
      hitTest: () => true,
      setInteractive
    });

    interactivity.recalc({ x: 1, y: 1 });
    interactivity.recalc({ x: 2, y: 2 });

    expect(setInteractive).toHaveBeenCalledTimes(1);
  });

  it('скрытое окно всегда становится прозрачным для мыши', () => {
    const setInteractive = vi.fn<(value: boolean) => void>();
    let visible = true;
    const interactivity = createInteractivity({
      isVisible: () => visible,
      hitTest: () => true,
      setInteractive
    });

    interactivity.recalc({ x: 1, y: 1 });
    visible = false;
    interactivity.recalc({ x: 1, y: 1 });

    expect(setInteractive).toHaveBeenLastCalledWith(false);
  });

  it('курсор вне области выключает интерактивность', () => {
    const setInteractive = vi.fn<(value: boolean) => void>();
    const interactivity = createInteractivity({
      isVisible: () => true,
      hitTest: () => false,
      setInteractive
    });

    interactivity.set(true);
    interactivity.recalc({ x: 1, y: 1 });

    expect(setInteractive).toHaveBeenLastCalledWith(false);
  });
});
