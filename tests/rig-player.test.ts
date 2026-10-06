// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RigPlayer } from '../src/renderer/character-rig/rig-player';

type ResizeCallback = (entries: ResizeObserverEntry[], observer: ResizeObserver) => void;

const callbacks: ResizeCallback[] = [];

class FakeResizeObserver {
  constructor(private readonly callback: ResizeCallback) {
    callbacks.push(callback);
  }

  observe(): void {}

  unobserve(): void {}

  disconnect(): void {
    const index = callbacks.indexOf(this.callback);
    if (index >= 0) {
      callbacks.splice(index, 1);
    }
  }
}

function sized(width: number, height: number): HTMLElement {
  const node = document.createElement('div');
  Object.defineProperty(node, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(node, 'clientHeight', { value: height, configurable: true });
  return node;
}

function resize(node: HTMLElement, width: number, height: number): void {
  Object.defineProperty(node, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(node, 'clientHeight', { value: height, configurable: true });
}

function canvasOf(container: HTMLElement): HTMLCanvasElement {
  const canvas = container.querySelector('canvas');
  if (canvas === null) {
    throw new Error('холст не создан');
  }
  return canvas;
}

beforeEach(() => {
  callbacks.length = 0;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('RigPlayer: размер холста под контейнер', () => {
  it('смена размера контейнера меняет пиксельный размер холста', async () => {
    const container = sized(100, 200);
    const player = new RigPlayer();
    await player.mount(container);
    const canvas = canvasOf(container);

    expect(canvas.width).toBe(100);
    expect(canvas.height).toBe(200);

    resize(container, 260, 520);
    for (const callback of [...callbacks]) {
      callback([], {} as ResizeObserver);
    }

    expect(canvas.width).toBe(260);
    expect(canvas.height).toBe(520);
  });

  it('без ResizeObserver размер пересчитывается раз в кадр', async () => {
    vi.unstubAllGlobals();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});

    const container = sized(100, 200);
    const player = new RigPlayer();
    await player.mount(container);
    const canvas = canvasOf(container);

    resize(container, 300, 400);
    expect(frames.length).toBeGreaterThan(0);
    frames[0](0);

    expect(canvas.width).toBe(300);
    expect(canvas.height).toBe(400);
  });
});
