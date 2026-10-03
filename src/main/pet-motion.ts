import type { BrowserWindow } from 'electron';

const SLIDE_MS = 900;

export interface Geometry {
  y: number;
  hiddenX: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Плавно двигает окно по горизонтали за SLIDE_MS миллисекунд.
export class Mover {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly window: BrowserWindow,
    private readonly geometry: Geometry
  ) {}

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  to(targetX: number, done?: () => void): void {
    this.stop();
    const startX = this.window.getBounds().x;
    const started = Date.now();
    this.timer = setInterval(() => {
      const progress = Math.min(1, (Date.now() - started) / SLIDE_MS);
      const x = Math.round(startX + (targetX - startX) * progress);
      this.window.setPosition(x, this.geometry.y);
      if (progress >= 1) {
        this.stop();
        done?.();
      }
    }, 16);
  }
}
