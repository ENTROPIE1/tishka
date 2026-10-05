import { describe, expect, it } from 'vitest';
import type { RigBone, RigClip } from '../src/renderer/character-rig/rig-data';
import { applyPoint, boneWorld, keyAt, RigPoseAnimator, sampleClip, type WorldContext } from '../src/renderer/character-rig/rig-pose';

function bone(id: string, parent: string | null, x: number, y: number): RigBone {
  return { id, parent, pivot: [x, y], label: id };
}

describe('keyAt', () => {
  it('плавно и линейно интерполирует хвост ключа', () => {
    const keys = [
      [0, 0],
      [1, 10]
    ];
    expect(keyAt(keys, 0.25, true)[0]).toBeCloseTo(2.5);
    expect(keyAt(keys, 0.25, false)[0]).toBeCloseTo((1 - Math.cos(Math.PI * 0.25)) / 2 * 10);
  });

  it('берёт недостающие поля из значений по умолчанию', () => {
    const keys = [
      [0, 0],
      [1, 0, 3, 4, 2]
    ];
    const [r, x, y, s] = keyAt(keys, 1, true);
    expect([r, x, y, s]).toEqual([0, 3, 4, 2]);
    const [r0, x0, y0, s0] = keyAt(keys, 0, true);
    expect([r0, x0, y0, s0]).toEqual([0, 0, 0, 1]);
  });
});

describe('мировые преобразования', () => {
  it('дочерняя кость поворачивается вокруг своей точки вместе с родителем', () => {
    const bones = new Map<string, RigBone>();
    const hips = bone('hips', null, 0, 0);
    const torso = bone('torso', 'hips', 100, 0);
    bones.set('hips', hips);
    bones.set('torso', torso);
    const ctx: WorldContext = { bones, pose: { rot: { torso: 90 }, trans: {} }, blinkK: 1 };
    const world = boneWorld('torso', ctx, {});
    expect(applyPoint(world, 100, 0)[0]).toBeCloseTo(100);
    expect(applyPoint(world, 100, 0)[1]).toBeCloseTo(0);
    const moved = applyPoint(world, 200, 0);
    expect(moved[0]).toBeCloseTo(100);
    expect(moved[1]).toBeCloseTo(100);
  });

  it('сдвиг родителя переносится на потомка', () => {
    const bones = new Map<string, RigBone>([
      ['hips', bone('hips', null, 10, 20)],
      ['torso', bone('torso', 'hips', 30, 20)]
    ]);
    const ctx: WorldContext = { bones, pose: { rot: {}, trans: { hips: { x: 5, y: -5, s: 1 } } }, blinkK: 1 };
    const world = boneWorld('torso', ctx, {});
    expect(applyPoint(world, 30, 20)).toEqual([35, 15]);
  });
});

describe('RigPoseAnimator', () => {
  function animator(): RigPoseAnimator {
    const clips: Record<string, RigClip> = {
      a: { len: 10, loop: true, linear: ['head'], bones: { head: [[0, 0], [1, 10], [10, 10]] }, set: [] },
      b: { len: 1, loop: false, linear: ['head'], bones: { head: [[0, 0], [1, 20]] }, set: [] },
      looped: { len: 2, loop: true, linear: ['head'], bones: { head: [[0, 0], [1, 10], [2, 0]] }, set: [] }
    };
    return new RigPoseAnimator(clips);
  }

  it('держится цикла: значение в начале повтора совпадает', () => {
    const anim = animator();
    anim.playClip('looped', 0);
    expect(anim.update(500).time).toBeCloseTo(0.5);
    const first = anim.current.rot['head'];
    anim.update(2500);
    expect(anim.current.rot['head']).toBeCloseTo(first);
  });

  it('плавно смешивает позы при смене клипа', () => {
    const anim = animator();
    anim.playClip('a', 0);
    anim.update(300);
    expect(anim.current.rot['head']).toBeCloseTo(3);
    anim.playClip('b', 1000);
    anim.update(1100);
    expect(anim.current.rot['head']).toBeCloseTo(2.5);
    anim.update(1200);
    expect(anim.current.rot['head']).toBeCloseTo(4);
  });

  it('разовый клип без next просто кончается', () => {
    const anim = animator();
    anim.playClip('b', 0);
    const phase = anim.update(1200);
    expect(phase.ended).toBe(true);
    expect(phase.next).toBeUndefined();
    expect(anim.clip).toBeNull();
  });

  it('sampleClip заполняет поворот и преобразование', () => {
    const sample = sampleClip({ len: 1, loop: true, bones: { head: [[0, 2, 1, -1, 1.5]] }, set: [] }, 0);
    expect(sample.rot['head']).toBe(2);
    expect(sample.trans['head']).toEqual({ x: 1, y: -1, s: 1.5 });
  });
});
