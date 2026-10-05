// Физика игл и ушей: каждая кость — пружина на своей точке крепления.
// k — жёсткость, c — затухание, A — отставание от разгона, G — гравитация,
// sway — собственное покачивание, sway2 — мелкая дрожь, sy — пружина по высоте.

import type { RigModel } from './rig-data';
import { applyPoint, boneWorld, type Mat, type PoseState, type WorldContext } from './rig-pose';

export interface PhysConfig {
  k: number;
  c: number;
  A: number;
  G: number;
  sy?: boolean;
  sway?: number;
  f?: number;
  ph?: number;
  sway2?: number;
  f2?: number;
}

export const PHYS: Record<string, PhysConfig> = {
  quills: { k: 60, c: 7, A: 0.8, G: 1100, sy: true, sway: 80, f: 1.2, ph: 0.6, sway2: 160, f2: 3.1 },
  ear_l: { k: 120, c: 9, A: 0.6, G: 900, sway: 240, f: 0.45, ph: 0 },
  ear_r: { k: 120, c: 9, A: 0.6, G: 900, sway: 240, f: 0.53, ph: 1.7 }
};

interface Spring {
  th: number;
  v: number;
  s: number;
  sv: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  act: number;
}

function clampLimit(value: number): number {
  return Math.max(-4000, Math.min(4000, value));
}

export class RigPhysics {
  private readonly springs = new Map<string, Spring>();
  private last: number | null = null;
  readonly rot: Record<string, number> = {};
  readonly scale: Record<string, number> = {};

  reset(): void {
    this.springs.clear();
    this.last = null;
    for (const key of Object.keys(this.rot)) {
      delete this.rot[key];
    }
    for (const key of Object.keys(this.scale)) {
      delete this.scale[key];
    }
  }

  step(model: RigModel, pose: PoseState, now: number): void {
    if (this.last === null) {
      this.last = now;
      return;
    }
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (dt === 0) {
      return;
    }
    const bones = new Map(model.bones.map((bone) => [bone.id, bone]));
    const ctx: WorldContext = { bones, pose, blinkK: 1 };
    const cache: Record<string, Mat> = {};
    for (const [id, config] of Object.entries(PHYS)) {
      const bone = bones.get(id);
      if (bone === undefined || bone.parent === null) {
        continue;
      }
      const parent = boneWorld(bone.parent, ctx, cache);
      const point = applyPoint(parent, bone.pivot[0], bone.pivot[1]);
      const tilt = (Math.atan2(parent.b, parent.a) * 180) / Math.PI + (pose.rot[id] ?? 0);
      const spring = this.springs.get(id) ?? { th: 0, v: 0, s: 1, sv: 0, px: point[0], py: point[1], vx: 0, vy: 0, act: 0 };
      this.springs.set(id, spring);
      const vx = (point[0] - spring.px) / dt;
      const vy = (point[1] - spring.py) / dt;
      const ax = clampLimit((vx - spring.vx) / dt);
      const ay = clampLimit((vy - spring.vy) / dt);
      spring.px = point[0];
      spring.py = point[1];
      spring.vx = vx;
      spring.vy = vy;
      spring.act += (Math.hypot(vx, vy) - spring.act) * Math.min(1, dt * 3);
      const live = 0.15 + 0.85 * Math.min(1, spring.act / 120);
      let force = -config.k * spring.th - config.c * spring.v - config.A * ax + (config.G * Math.sin(((tilt + spring.th) * Math.PI) / 180));
      if (config.sway !== undefined) {
        force += live * config.sway * Math.sin((2 * Math.PI * (config.f ?? 0) * now) / 1000 + (config.ph ?? 0));
      }
      if (config.sway2 !== undefined) {
        force += live * config.sway2 * Math.sin((2 * Math.PI * (config.f2 ?? 0) * now) / 1000);
      }
      spring.v += force * dt;
      spring.th = Math.max(-25, Math.min(25, spring.th + spring.v * dt));
      if (config.sy === true) {
        const springForce = -90 * (spring.s - 1) - 9 * spring.sv + 0.0036 * ay;
        spring.sv += springForce * dt;
        spring.s = Math.max(0.85, Math.min(1.15, spring.s + spring.sv * dt));
      }
      this.rot[id] = spring.th;
      if (config.sy === true) {
        this.scale[id] = spring.s;
      }
    }
  }
}
