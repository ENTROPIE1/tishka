// Математика костной модели: мировые преобразования, ключи клипов, цикл и смешивание.
// Модуль не зависит от DOM: матрица 2D повторяет DOMMatrix (a b c d e f), но обычный объект.

import type { ClipKey, RigBone, RigClip } from './rig-data';
import { IDENTITY, rotate, scale, translate, type Mat } from './rig-matrix';

export { IDENTITY, applyPoint, invert, mul, rotate, scale, translate } from './rig-matrix';
export type { Mat } from './rig-matrix';

export interface Transform {
  x: number;
  y: number;
  s: number;
}

export interface PoseState {
  rot: Record<string, number>;
  trans: Record<string, Transform>;
}

export function emptyPose(): PoseState {
  return { rot: {}, trans: {} };
}

export function clonePose(pose: PoseState): PoseState {
  const trans: Record<string, Transform> = {};
  for (const [id, t] of Object.entries(pose.trans)) {
    trans[id] = { x: t.x, y: t.y, s: t.s };
  }
  return { rot: { ...pose.rot }, trans };
}

// [поворот, сдвиг x, сдвиг y, растяжение] в точке времени t; гладко, кроме linear-костей.
export function keyAt(keys: ClipKey[], t: number, linear = false): [number, number, number, number] {
  const v = (key: ClipKey, i: number): number => key[i] ?? (i === 4 ? 1 : 0);
  const head = keys[0];
  if (t <= head[0]) {
    return [v(head, 1), v(head, 2), v(head, 3), v(head, 4)];
  }
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i];
    if (t <= b[0]) {
      const a = keys[i - 1];
      const u = (t - a[0]) / (b[0] - a[0] || 1);
      const e = linear ? u : (1 - Math.cos(Math.PI * u)) / 2;
      const at = (j: number): number => v(a, j) + (v(b, j) - v(a, j)) * e;
      return [at(1), at(2), at(3), at(4)];
    }
  }
  const last = keys[keys.length - 1];
  return [v(last, 1), v(last, 2), v(last, 3), v(last, 4)];
}

export function sampleClip(clip: RigClip, t: number): PoseState {
  const pose = emptyPose();
  for (const [id, keys] of Object.entries(clip.bones)) {
    const [r, x, y, s] = keyAt(keys, t, (clip.linear ?? []).includes(id));
    pose.rot[id] = r;
    pose.trans[id] = { x, y, s };
  }
  return pose;
}

export function blendPose(from: PoseState, to: PoseState, k: number): PoseState {
  const pose = emptyPose();
  for (const id of new Set([...Object.keys(from.rot), ...Object.keys(to.rot)])) {
    const a = from.rot[id] ?? 0;
    const b = to.rot[id] ?? 0;
    pose.rot[id] = a + (b - a) * k;
  }
  for (const id of new Set([...Object.keys(from.trans), ...Object.keys(to.trans)])) {
    const a = from.trans[id] ?? { x: 0, y: 0, s: 1 };
    const b = to.trans[id] ?? { x: 0, y: 0, s: 1 };
    pose.trans[id] = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, s: a.s + (b.s - a.s) * k };
  }
  return pose;
}

export interface WorldContext {
  bones: Map<string, RigBone>;
  pose: PoseState;
  blinkK: number;
  // Поворот и растяжение от физики игл и ушей; нет — берутся нулём и единицей.
  physR?: Record<string, number>;
  physS?: Record<string, number>;
}

// Мировая матрица кости: от родителя, затем сдвиг, поворот и растяжение вокруг её точки.
export function boneWorld(id: string, ctx: WorldContext, cache: Record<string, Mat> = {}): Mat {
  const cached = cache[id];
  if (cached !== undefined) {
    return cached;
  }
  const bone = ctx.bones.get(id);
  if (bone === undefined) {
    throw new Error(`Нет кости «${id}»`);
  }
  let m = bone.parent !== null ? boneWorld(bone.parent, ctx, cache) : IDENTITY;
  const t = ctx.pose.trans[id] ?? { x: 0, y: 0, s: 1 };
  const rot = (ctx.pose.rot[id] ?? 0) + (ctx.physR?.[id] ?? 0);
  const sy = t.s * (ctx.physS?.[id] ?? 1);
  m = translate(m, bone.pivot[0] + t.x, bone.pivot[1] + t.y);
  m = rotate(m, rot);
  m = scale(m, 1, sy);
  m = translate(m, -bone.pivot[0], -bone.pivot[1]);
  if (ctx.blinkK !== 1 && (id === 'eye_l' || id === 'eye_r')) {
    const lid = bone.pivot[1] + 22;
    m = translate(m, bone.pivot[0], lid);
    m = scale(m, 1, ctx.blinkK);
    m = translate(m, -bone.pivot[0], -lid);
  }
  cache[id] = m;
  return m;
}

export interface ClipPhase {
  ended: boolean;
  next?: string;
  time: number;
}

export const CLIP_BLEND_MS = 200;

// Проигрывает клип по времени, плавно перетекая из прежней позы при смене.
export class RigPoseAnimator {
  private play: { name: string; clip: RigClip; t0: number } | null = null;
  private blend: { from: PoseState; t0: number } | null = null;
  private pose: PoseState = emptyPose();

  constructor(
    private readonly clips: Record<string, RigClip>,
    private readonly blendMs: number = CLIP_BLEND_MS
  ) {}

  get current(): PoseState {
    return this.pose;
  }

  get clipName(): string | null {
    return this.play?.name ?? null;
  }

  get clip(): RigClip | null {
    return this.play?.clip ?? null;
  }

  playClip(name: string, now: number): void {
    const clip = this.clips[name];
    if (clip === undefined) {
      return;
    }
    this.blend = { from: clonePose(this.pose), t0: now };
    this.play = { name, clip, t0: now };
  }

  stop(): void {
    this.play = null;
    this.blend = null;
    this.pose = emptyPose();
  }

  update(now: number): ClipPhase {
    if (this.play === null) {
      return { ended: false, time: 0 };
    }
    const clip = this.play.clip;
    let t = (now - this.play.t0) / 1000;
    if (t >= clip.len) {
      if (clip.loop === true) {
        this.play.t0 += clip.len * 1000 * Math.floor(t / clip.len);
        t %= clip.len;
      } else {
        const next = clip.next;
        this.play = null;
        this.blend = null;
        return next === undefined ? { ended: true, time: clip.len } : { ended: true, next, time: clip.len };
      }
    }
    const target = sampleClip(clip, t);
    const k = this.blend !== null ? Math.min(1, (now - this.blend.t0) / this.blendMs) : 1;
    this.pose = this.blend !== null ? blendPose(this.blend.from, target, k) : target;
    if (k >= 1) {
      this.blend = null;
    }
    return { ended: false, time: t };
  }
}
