import { describe, expect, it } from 'vitest';
import { emptyShow, type RigClip, type RigLayer, type RigModel } from '../src/renderer/character-rig/rig-data';
import { drawOrder, maskHas } from '../src/renderer/character-rig/rig-draw';
import { emptyPose, type WorldContext } from '../src/renderer/character-rig/rig-pose';

function layer(id: string, bone: string, group?: string): RigLayer {
  return group === undefined ? { id, src: `layers/${id}.png`, bone } : { id, src: `layers/${id}.png`, bone, group };
}

function makeModel(layers: RigLayer[]): RigModel {
  return {
    version: 3,
    rev: 0,
    canvas: 1200,
    axisX: 399.5,
    bones: [],
    layers,
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

const ctx = (): WorldContext => ({ bones: new Map(), pose: emptyPose(), blinkK: 1 });

describe('drawOrder', () => {
  it('выносит кости из front в конец порядка', () => {
    const model = makeModel([
      layer('a', 'a'),
      layer('b', 'b'),
      layer('c1', 'c'),
      layer('c2', 'c'),
      layer('d', 'd')
    ]);
    const clip: RigClip = { len: 1, loop: true, front: ['c'], bones: {}, set: [] };
    const order = drawOrder(model, ctx(), clip).map((l) => l.id);
    expect(order.slice(0, 3)).toEqual(['a', 'b', 'd']);
    expect(order.slice(3).sort()).toEqual(['c1', 'c2']);
  });

  it('без клипа сохраняет исходный порядок', () => {
    const model = makeModel([layer('a', 'a'), layer('b', 'b')]);
    expect(drawOrder(model, ctx(), null).map((l) => l.id)).toEqual(['a', 'b']);
  });

  it('ставит underTablet перед планшетом', () => {
    const model = makeModel([
      layer('x', 'x'),
      layer('tablet', 'torso', 'tablet'),
      layer('arm', 'arm_r_lower'),
      layer('tail', 'tail')
    ]);
    const clip: RigClip = { len: 1, loop: true, underTablet: ['arm_r_lower'], bones: {}, set: [] };
    const order = drawOrder(model, ctx(), clip).map((l) => l.id);
    expect(order).toEqual(['x', 'arm', 'tablet', 'tail']);
  });
});

describe('maskHas', () => {
  it('читает биты маски и границы', () => {
    const mask = { x: 0, y: 0, gw: 1, gh: 1, b: 'gA==' };
    expect(maskHas(mask, 0, 0)).toBe(true);
    expect(maskHas(mask, 3, 0)).toBe(false);
  });
});
