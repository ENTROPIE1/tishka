// Порядок рисования и рисование на CanvasRenderingContext2D: слои по порядку,
// front и underTablet из клипа, над толстовкой, отсечение зрачка белком и иголки.

import type { RigBone, RigClip, RigLayer, RigModel, RigShow } from './rig-data';
import { applyPoint, boneWorld, invert, mul, rotate, scale, translate, type Mat, type PoseState, type WorldContext } from './rig-pose';
import { drawQuills } from './rig-quills';
import { eyeState, layerVisible } from './rig-show';

export function boneMap(model: RigModel): Map<string, RigBone> {
  return new Map(model.bones.map((bone) => [bone.id, bone]));
}

export function maskHas(mask: { x: number; y: number; gw: number; gh: number; b: string; bits?: Uint8Array }, x: number, y: number): boolean {
  const gx = Math.floor((x - mask.x) / 3);
  const gy = Math.floor((y - mask.y) / 3);
  if (gx < 0 || gy < 0 || gx >= mask.gw || gy >= mask.gh) {
    return false;
  }
  if (mask.bits === undefined) {
    mask.bits = Uint8Array.from(atob(mask.b), (c) => c.charCodeAt(0));
  }
  const n = gy * mask.gw + gx;
  return (mask.bits[n >> 3] & (128 >> (n & 7))) !== 0;
}

// Запястье или середина предплечья на зоне туловища — рука идёт поверх толстовки.
export function armInFront(side: 'l' | 'r', model: RigModel, ctx: WorldContext, world: Record<string, Mat>): boolean {
  const rule = model.armFront;
  const zone = model.masks[rule.zone];
  if (!rule.enabled || zone === undefined) {
    return false;
  }
  const hand = ctx.bones.get(`hand_${side}`);
  const lower = ctx.bones.get(`arm_${side}_lower`);
  const upper = ctx.bones.get(`arm_${side}_upper`);
  if (hand === undefined || lower === undefined || upper === undefined) {
    return false;
  }
  const torsoInv = invert(boneWorld('torso', ctx, world));
  const wrist = applyPoint(boneWorld(`arm_${side}_lower`, ctx, world), hand.pivot[0], hand.pivot[1]);
  const elbow = applyPoint(boneWorld(`arm_${side}_upper`, ctx, world), lower.pivot[0], lower.pivot[1]);
  const mid: [number, number] = [(wrist[0] + elbow[0]) / 2, (wrist[1] + elbow[1]) / 2];
  return [wrist, mid].some((p) => maskHas(zone, ...applyPoint(torsoInv, p[0], p[1])));
}

export function drawOrder(model: RigModel, ctx: WorldContext, clip: RigClip | null): RigLayer[] {
  let order = model.layers;
  if (clip?.underTablet !== undefined) {
    const under = clip.underTablet;
    const f = (l: RigLayer): boolean => under.includes(l.bone);
    const rest = order.filter((l) => !f(l));
    const at = rest.findIndex((l) => l.group === 'tablet');
    if (at >= 0) {
      order = [...rest.slice(0, at), ...order.filter(f), ...rest.slice(at)];
    }
  }
  if (clip?.front !== undefined) {
    const front = clip.front;
    const f = (l: RigLayer): boolean => front.includes(l.bone);
    order = [...order.filter((l) => !f(l)), ...order.filter(f)];
  }
  const world: Record<string, Mat> = {};
  for (const side of ['l', 'r'] as const) {
    if (!armInFront(side, model, ctx, world)) {
      continue;
    }
    const move = (l: RigLayer): boolean => l.bone === `arm_${side}_lower` || l.bone === `hand_${side}`;
    const moved = order.filter(move);
    const rest = order.filter((l) => !move(l));
    const at = rest.findIndex((l) => l.id === model.armFront.above) + 1;
    order = [...rest.slice(0, at), ...moved, ...rest.slice(at)];
  }
  return order;
}

export interface RenderState {
  pose: PoseState;
  show: RigShow;
  clip: RigClip | null;
  blinkK: number;
  physR?: Record<string, number>;
  physS?: Record<string, number>;
  image(src: string): HTMLImageElement | undefined;
}

// Матрица слоя из координат картинки в координаты холста 1200×1200.
export function layerMatrix(model: RigModel, layer: RigLayer, ctx: WorldContext, state: RenderState, world: Record<string, Mat>): Mat {
  const m0 = boneWorld(layer.bone, ctx, world);
  if (layer.hand !== undefined) {
    const bone = model.bones.find((b) => b.id === layer.bone);
    const anchor = layer.variant !== undefined ? model.handAnchors[layer.variant] : undefined;
    if (bone === undefined || anchor === undefined) {
      return m0;
    }
    const h = layer.hand;
    let m = translate(m0, bone.pivot[0] + h.x, bone.pivot[1] + h.y);
    m = rotate(m, (h.flip ? anchor.rotFlip : anchor.rot) + h.rot);
    m = scale(m, h.flip ? -h.scale : h.scale, h.scale);
    return translate(m, -anchor.ax, -anchor.ay);
  }
  let m = translate(m0, layer.dx ?? 0, layer.dy ?? 0);
  if (layer.group === 'tablet' && state.clip?.tabletY !== undefined) {
    m = translate(m, 0, state.clip.tabletY);
  }
  if (layer.eyePart === 'iris' || layer.eyePart === 'hl') {
    const eye = eyeState(state.show, layer.side);
    const k = eye.useShape ? (model.eyeShapes[eye.shape]?.irisScale ?? 1) : 1;
    const mask = model.masks[`layers/eye_${layer.side}_iris.png`];
    if (k !== 1 && mask !== undefined) {
      const cx = mask.x + mask.gw * 1.5;
      const cy = mask.y + mask.gh * 1.5;
      m = translate(m, cx, cy);
      m = scale(m, k, k);
      m = translate(m, -cx, -cy);
    }
  }
  return m;
}

let offscreen: HTMLCanvasElement | null = null;

function paint(target: CanvasRenderingContext2D, m: Mat, img: HTMLImageElement): void {
  target.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
  target.drawImage(img, 0, 0);
}

function drawClipped(target: CanvasRenderingContext2D, model: RigModel, layer: RigLayer, img: HTMLImageElement, base: Mat, ctx: WorldContext, state: RenderState, world: Record<string, Mat>): void {
  const white = model.layers.find((l) => l.eyePart === 'white' && l.side === layer.side && layerVisible(l, state.show, model.layers));
  const whiteImg = white !== undefined ? state.image(white.src) : undefined;
  if (white === undefined || whiteImg === undefined || !whiteImg.complete) {
    paint(target, mul(base, layerMatrix(model, layer, ctx, state, world)), img);
    return;
  }
  if (offscreen === null) {
    offscreen = document.createElement('canvas');
  }
  if (offscreen.width !== target.canvas.width || offscreen.height !== target.canvas.height) {
    offscreen.width = target.canvas.width;
    offscreen.height = target.canvas.height;
  }
  const o = offscreen.getContext('2d');
  if (o === null) {
    return;
  }
  o.setTransform(1, 0, 0, 1, 0, 0);
  o.globalCompositeOperation = 'source-over';
  o.clearRect(0, 0, offscreen.width, offscreen.height);
  paint(o, mul(base, layerMatrix(model, layer, ctx, state, world)), img);
  o.globalCompositeOperation = 'destination-in';
  paint(o, mul(base, layerMatrix(model, white, ctx, state, world)), whiteImg);
  o.globalCompositeOperation = 'source-over';
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.drawImage(offscreen, 0, 0);
}

export function drawCharacter(target: CanvasRenderingContext2D, model: RigModel, base: Mat, state: RenderState): void {
  const ctx: WorldContext = { bones: boneMap(model), pose: state.pose, blinkK: state.blinkK, physR: state.physR, physS: state.physS };
  const world: Record<string, Mat> = {};
  for (const layer of drawOrder(model, ctx, state.clip)) {
    if (!layerVisible(layer, state.show, model.layers)) {
      continue;
    }
    const img = state.image(layer.src);
    if (img === undefined || !img.complete || !img.naturalWidth) {
      continue;
    }
    if (layer.eyePart === 'iris' || layer.eyePart === 'hl') {
      drawClipped(target, model, layer, img, base, ctx, state, world);
      continue;
    }
    if (layer.bone === 'quills' && drawQuills(target, model, layer, img, base, ctx, world)) {
      continue;
    }
    paint(target, mul(base, layerMatrix(model, layer, ctx, state, world)), img);
  }
}
