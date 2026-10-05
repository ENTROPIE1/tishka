import { describe, expect, it } from 'vitest';
import type { RigModel } from '../src/renderer/character-rig/rig-data';
import { emptyShow } from '../src/renderer/character-rig/rig-data';
import { emptyPose } from '../src/renderer/character-rig/rig-pose';
import { RigPhysics } from '../src/renderer/character-rig/rig-physics';

function model(): RigModel {
  return {
    version: 3,
    rev: 0,
    canvas: 1200,
    axisX: 399.5,
    bones: [
      { id: 'head', parent: null, pivot: [400, 400], label: 'голова' },
      { id: 'quills', parent: 'head', pivot: [400, 300], label: 'иголки' },
      { id: 'ear_l', parent: 'head', pivot: [340, 260], label: 'ухо' }
    ],
    layers: [],
    armPoses: {},
    armFront: { enabled: false, zone: 'zone/torso', above: 'hoodie_front' },
    show: emptyShow(),
    masks: {},
    eyeShapes: {},
    irisVariants: [],
    handAnchors: {},
    mouths: [],
    fx: [],
    clips: {},
    moods: {}
  };
}

describe('RigPhysics', () => {
  it('гасит движение в покое и держит иглы в разумных пределах', () => {
    const physics = new RigPhysics();
    const pose = emptyPose();
    pose.trans['head'] = { x: 0, y: 0, s: 1 };
    const rig = model();
    physics.step(rig, pose, 0);
    for (let i = 1; i <= 20; i++) {
      physics.step(rig, pose, i * 16);
    }
    expect(Math.abs(physics.rot['quills'] ?? 0)).toBeLessThanOrEqual(25);
    expect(physics.scale['quills']).toBeGreaterThanOrEqual(0.85);
    expect(physics.scale['quills']).toBeLessThanOrEqual(1.15);
  });

  it('отклоняет иглы при резком сдвиге головы', () => {
    const physics = new RigPhysics();
    const pose = emptyPose();
    const rig = model();
    physics.step(rig, pose, 0);
    pose.trans['head'] = { x: 200, y: 0, s: 1 };
    physics.step(rig, pose, 16);
    expect(Math.abs(physics.rot['quills'] ?? 0)).toBeGreaterThan(0);
  });
});
