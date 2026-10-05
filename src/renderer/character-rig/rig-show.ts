// «Что показано»: глаза, брови, рот, кисти, эффекты, планшет; события set клипа и моргание.
// Модуль не зависит от DOM.

import type { RigClip, RigLayer, RigShow } from './rig-data';

export const NO_BLINK_SHAPES = ['happy', 'laugh', 'sleepy'];

export interface EyeState {
  st: 'open' | 'closed';
  shape: string;
  useShape: boolean;
  whiteOn: boolean;
  iris: string;
}

// Закрытый глаз при подмигивании важнее обычного состояния; форма работает только на открытом.
export function eyeState(show: RigShow, side?: 'l' | 'r'): EyeState {
  const st = side !== undefined && show.wink === side ? 'closed' : show.eyes;
  const shape = show.eyeShape || 'orig';
  const useShape = st === 'open' && shape !== 'orig';
  return { st, shape, useShape, whiteOn: st !== 'closed', iris: show.iris || 'orig' };
}

export function layerVisible(layer: RigLayer, show: RigShow, layers: readonly RigLayer[]): boolean {
  if (layer.eyePart !== undefined) {
    const eye = eyeState(show, layer.side);
    if (layer.eyePart === 'white') {
      return eye.whiteOn && layer.shape === (eye.useShape ? eye.shape : 'orig');
    }
    if (layer.eyePart === 'line') {
      return eye.useShape ? layer.shape === eye.shape : layer.shape === 'orig' && layer.lid === eye.st;
    }
    if (!eye.whiteOn) {
      return false;
    }
    if (layer.eyePart === 'hl') {
      return eye.iris === 'orig' && eye.st === 'open';
    }
    return layer.iris === eye.iris;
  }
  if (layer.headphones === true) {
    return false;
  }
  if (layer.ball === true) {
    return show.ball === true;
  }
  if (layer.buds === true) {
    return show.headphones;
  }
  if (layer.glow === true) {
    return show.glow && show.tablet !== 'none';
  }
  if (layer.fxName !== undefined) {
    const requested = show.fxSet;
    const set = layers.some((x) => x.fxName === layer.fxName && x.fxSet === requested) ? requested : 1;
    return show.fx.includes(layer.fxName) && layer.fxSet === set;
  }
  if (layer.group === undefined) {
    return true;
  }
  if (layer.group === 'mouth') {
    return layer.variant === show.mouth;
  }
  if (layer.group.startsWith('brow_')) {
    return layer.variant === (show.brows || 'orig');
  }
  return layer.variant === show[layer.group as keyof RigShow];
}

export function setPatch(show: RigShow, patch: Partial<RigShow>): RigShow {
  return { ...show, ...patch };
}

// Состояние лица в момент t: базовое плюс все события set клипа, случившиеся к этому времени.
export function showAt(base: RigShow, clip: RigClip | null, t: number): RigShow {
  let show = base;
  if (clip === null) {
    return show;
  }
  for (const [at, patch] of clip.set) {
    if (at > t) {
      break;
    }
    show = setPatch(show, patch);
  }
  return show;
}

export function shouldAutoBlink(show: RigShow, clip: RigClip | null): boolean {
  if (clip !== null && clip.noBlink === true) {
    return false;
  }
  return show.eyes === 'open' && !NO_BLINK_SHAPES.includes(show.eyeShape);
}

export function blinkFactor(elapsedMs: number): number {
  if (elapsedMs < 60) {
    return 1 - 0.92 * (elapsedMs / 60) ** 2;
  }
  if (elapsedMs < 100) {
    return 0.08;
  }
  const u = (elapsedMs - 100) / 110;
  return 0.08 + 0.92 * (1 - (1 - u) ** 2);
}

export const BLINK_DURATION_MS = 210;
export const AUTO_BLINK_MIN_MS = 3000;
export const AUTO_BLINK_EXTRA_MS = 2000;

// Один цикл моргания: закрытие, короткая пауза, открытие.
export class Blinker {
  private t0: number | null = null;

  get active(): boolean {
    return this.t0 !== null;
  }

  begin(now: number): void {
    if (this.t0 === null) {
      this.t0 = now;
    }
  }

  // Возвращает сжатие века (1 — открыто); null, когда моргание закончилось.
  value(now: number): number | null {
    if (this.t0 === null) {
      return null;
    }
    const elapsed = now - this.t0;
    if (elapsed >= BLINK_DURATION_MS) {
      this.t0 = null;
      return null;
    }
    return blinkFactor(elapsed);
  }
}

export function nextBlinkDelay(random: () => number = Math.random): number {
  return AUTO_BLINK_MIN_MS + random() * AUTO_BLINK_EXTRA_MS;
}
