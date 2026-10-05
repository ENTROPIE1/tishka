// Гнущиеся иголки: слой режется на кольца вокруг точки кости, каждое кольцо
// получает свою долю поворота, сдвига и растяжения. Часть рисования слоя.

import type { RigLayer, RigModel } from './rig-data';
import { boneWorld, IDENTITY, mul, rotate, scale, translate, type Mat, type WorldContext } from './rig-pose';

export const QUILL_R0 = 110;
export const QUILL_R1 = 300;
export const QUILL_RINGS = [0, 110, 140, 170, 200, 235, 270, 310, 420];

export interface QuillRing {
  canvas: HTMLCanvasElement;
  x0: number;
  y0: number;
  wgt: number;
}

const cache = new Map<string, QuillRing[]>();
let buffer: HTMLCanvasElement | null = null;

export function quillRings(model: RigModel, layer: RigLayer, img: HTMLImageElement): QuillRing[] | null {
  const cached = cache.get(layer.src);
  if (cached !== undefined) {
    return cached;
  }
  const mask = model.masks[layer.src];
  const bone = model.bones.find((b) => b.id === layer.bone);
  if (mask === undefined || bone === undefined || !img.complete || !img.naturalWidth) {
    return null;
  }
  const x0 = mask.x - 4;
  const y0 = mask.y - 4;
  const w = mask.gw * 3 + 8;
  const h = mask.gh * 3 + 8;
  const cx = bone.pivot[0] - x0;
  const cy = bone.pivot[1] - y0;
  const R = QUILL_RINGS;
  const far = R[R.length - 1];
  const rings: QuillRing[] = [];
  for (let k = 0; k < R.length - 1; k++) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    if (g === null) {
      return null;
    }
    g.drawImage(img, -x0, -y0);
    const lo = k === 0 ? 0 : R[k - 1];
    const mid = R[k];
    const hi = R[k + 1];
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, far);
    const stop = (r: number, a: number): void =>
      grad.addColorStop(Math.min(1, Math.max(0, r / far)), `rgba(0,0,0,${a})`);
    if (k === 0) {
      stop(0, 1);
      stop(mid, 1);
      stop(hi, 0);
    } else if (k === R.length - 2) {
      stop(lo, 0);
      stop(mid, 1);
      stop(far, 1);
    } else {
      stop(lo, 0);
      stop(mid, 1);
      stop(hi, 0);
    }
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    const wgt = Math.max(0, Math.min(1, (mid - QUILL_R0) / (QUILL_R1 - QUILL_R0)));
    rings.push({ canvas, x0, y0, wgt });
  }
  cache.set(layer.src, rings);
  return rings;
}

export function drawQuills(
  target: CanvasRenderingContext2D,
  model: RigModel,
  layer: RigLayer,
  img: HTMLImageElement,
  base: Mat,
  ctx: WorldContext,
  world: Record<string, Mat>
): boolean {
  const rings = quillRings(model, layer, img);
  const bone = model.bones.find((b) => b.id === layer.bone);
  if (rings === null || bone === undefined) {
    return false;
  }
  const parent = bone.parent !== null ? boneWorld(bone.parent, ctx, world) : IDENTITY;
  const ang = ctx.pose.rot[bone.id] ?? 0;
  const t = ctx.pose.trans[bone.id] ?? { x: 0, y: 0, s: 1 };
  const [px, py] = bone.pivot;
  if (buffer === null) {
    buffer = document.createElement('canvas');
  }
  if (buffer.width !== target.canvas.width || buffer.height !== target.canvas.height) {
    buffer.width = target.canvas.width;
    buffer.height = target.canvas.height;
  }
  const b = buffer.getContext('2d');
  if (b === null) {
    return false;
  }
  b.setTransform(1, 0, 0, 1, 0, 0);
  b.globalCompositeOperation = 'source-over';
  b.clearRect(0, 0, buffer.width, buffer.height);
  b.globalCompositeOperation = 'lighter';
  for (const ring of rings) {
    const k = ring.wgt;
    let m = translate(mul(base, parent), px + t.x * k + (layer.dx ?? 0), py + t.y * k + (layer.dy ?? 0));
    m = rotate(m, ang * k);
    m = scale(m, 1, 1 + (t.s - 1) * k);
    m = translate(m, -px, -py);
    b.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    b.drawImage(ring.canvas, ring.x0, ring.y0);
  }
  b.globalCompositeOperation = 'source-over';
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.drawImage(buffer, 0, 0);
  return true;
}

export function clearQuillCache(): void {
  cache.clear();
}
