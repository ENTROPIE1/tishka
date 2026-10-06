// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canvasPixelOpaque,
  createInteractivity,
  hitTestRegions,
  isInteractiveTarget
} from '../src/renderer/pet/interactivity';

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

interface PointDocument {
  elementFromPoint?(x: number, y: number): Element | null;
}

function paintedCanvas(alpha: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 10;
  canvas.height = 10;
  canvas.getContext = (() => ({
    getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, alpha]) })
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  canvas.getBoundingClientRect = (() =>
    ({ left: 0, top: 0, width: 10, height: 10 }) as DOMRect) as typeof canvas.getBoundingClientRect;
  return canvas;
}

function elementAt(element: Element | null): void {
  (document as unknown as PointDocument).elementFromPoint = () => element;
}

afterEach(() => {
  delete (document as unknown as PointDocument).elementFromPoint;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('попадание по холсту нового персонажа', () => {
  it('прозрачный пиксель холста мышь не ловит', () => {
    const canvas = paintedCanvas(0);
    const character = document.createElement('div');
    elementAt(null);

    expect(hitTestRegions([character], 5, 5, { canvas, opaque: canvasPixelOpaque })).toBe(false);
  });

  it('непрозрачный пиксель холста ловит мышь', () => {
    const canvas = paintedCanvas(255);
    const character = document.createElement('div');
    elementAt(null);

    expect(hitTestRegions([character], 5, 5, { canvas, opaque: canvasPixelOpaque })).toBe(true);
  });

  it('прозрачный холст пропускает щелчок к строке ввода под ним', () => {
    const canvas = paintedCanvas(0);
    const character = document.createElement('div');
    const composer = document.createElement('form');
    elementAt(composer);

    expect(
      hitTestRegions([character, composer], 5, 5, { canvas, opaque: canvasPixelOpaque })
    ).toBe(true);
  });

  it('в зеркальной раскладке прозрачный пиксель тоже пропускает к строке', () => {
    const canvas = paintedCanvas(0);
    canvas.style.transform = 'scaleX(-1)';
    const character = document.createElement('div');
    const composer = document.createElement('form');
    elementAt(composer);

    expect(
      hitTestRegions([character, composer], 5, 5, { canvas, opaque: canvasPixelOpaque })
    ).toBe(true);
  });

  it('полупрозрачный край холста мышь не ловит', () => {
    const canvas = paintedCanvas(4);
    const character = document.createElement('div');
    elementAt(null);

    expect(hitTestRegions([character], 5, 5, { canvas, opaque: canvasPixelOpaque })).toBe(false);
  });

  it('прежний ёж: попадание по элементам, как раньше', () => {
    const character = document.createElement('div');
    elementAt(character);

    expect(hitTestRegions([character], 5, 5)).toBe(true);

    elementAt(null);
    expect(hitTestRegions([character], 5, 5)).toBe(false);
  });
});

describe('клики по элементам строки ввода', () => {
  it('не запускают перетаскивание поверх холста', () => {
    const button = document.createElement('button');
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    button.append(icon);
    const input = document.createElement('input');

    expect(isInteractiveTarget(button)).toBe(true);
    expect(isInteractiveTarget(icon)).toBe(true);
    expect(isInteractiveTarget(input)).toBe(true);
    expect(isInteractiveTarget(document.createElement('div'))).toBe(false);
  });
});

describe('canvasPixelOpaque', () => {
  it('читает пиксель с учётом размера холста', () => {
    const canvas = paintedCanvas(255);
    expect(canvasPixelOpaque(canvas, 5, 5)).toBe(true);
  });

  it('зеркальный холст читает пиксель с учётом отражения', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 10;
    canvas.height = 10;
    canvas.getContext = (() => ({
      getImageData: (px: number) => ({ data: new Uint8ClampedArray([0, 0, 0, px >= 5 ? 255 : 0]) })
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    canvas.getBoundingClientRect = (() =>
      ({ left: 0, top: 0, width: 10, height: 10 }) as DOMRect) as typeof canvas.getBoundingClientRect;

    canvas.style.transform = 'scaleX(-1)';
    // В отражении точка x=2 смотрит на исходный пиксель 8 — непрозрачный.
    expect(canvasPixelOpaque(canvas, 2, 5)).toBe(true);

    canvas.style.transform = '';
    expect(canvasPixelOpaque(canvas, 2, 5)).toBe(false);
    expect(canvasPixelOpaque(canvas, 8, 5)).toBe(true);
  });

  it('точка вне холста — прозрачно', () => {
    const canvas = paintedCanvas(255);
    canvas.getBoundingClientRect = (() =>
      ({ left: 100, top: 100, width: 10, height: 10 }) as DOMRect) as typeof canvas.getBoundingClientRect;
    expect(canvasPixelOpaque(canvas, 5, 5)).toBe(false);
  });
});
