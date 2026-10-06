// Размер холста персонажа под контейнер с учётом плотности пикселей. Смену
// размера контейнера ловит ResizeObserver, если он есть; иначе подходящий
// размер сверяется раз в кадр через tick().

import { IDENTITY, scale, translate, type Mat } from './rig-matrix';

// Матрица отрисовки под контейнер: масштаб и отражение. Холст к этому моменту
// уже приведён к нужному пиксельному размеру.
export function fitMatrix(container: HTMLElement | null, canvas: HTMLCanvasElement, flipped: boolean): Mat {
  const dpr = window.devicePixelRatio || 1;
  const width = container?.clientWidth ?? canvas.clientWidth;
  const height = container?.clientHeight ?? canvas.clientHeight;
  canvas.style.transform = flipped ? 'scaleX(-1)' : '';
  const s = Math.min(width / 520, height / 1220);
  const base = scale(IDENTITY, dpr, dpr);
  return scale(translate(base, width / 2 - 400 * s, height / 2 - 605 * s), s, s);
}

export class RigCanvasSizer {
  private canvas: HTMLCanvasElement | null = null;
  private container: HTMLElement | null = null;
  private observer: ResizeObserver | null = null;

  attach(container: HTMLElement, canvas: HTMLCanvasElement): void {
    this.container = container;
    this.canvas = canvas;
    this.sync();
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => {
        this.sync();
      });
      this.observer.observe(container);
    }
  }

  detach(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.canvas = null;
    this.container = null;
  }

  // Без наблюдателя вызывается каждый кадр: размер считается при смене.
  tick(): void {
    if (this.observer === null) {
      this.sync();
    }
  }

  // Ширина и высота холста задаются парой: иначе картинка расплывается.
  private sync(): void {
    const canvas = this.canvas;
    if (canvas === null) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const width = this.container?.clientWidth ?? canvas.clientWidth;
    const height = this.container?.clientHeight ?? canvas.clientHeight;
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
  }
}
