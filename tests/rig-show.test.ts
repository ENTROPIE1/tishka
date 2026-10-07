import { describe, expect, it } from 'vitest';
import { emptyShow, type RigClip, type RigShow } from '../src/renderer/character-rig/rig-data';
import { Blinker, blinkFactor, eyeState, showAt, shouldAutoBlink } from '../src/renderer/character-rig/rig-show';

function base(): RigShow {
  return { ...emptyShow(), mouth: 'closed', eyeShape: 'orig' };
}

describe('showAt', () => {
  it('применяет события set в своё время', () => {
    const clip: RigClip = {
      len: 2,
      loop: true,
      bones: {},
      set: [
        [0, { eyeShape: 'neutral', brows: 'kind' }],
        [1, { mouth: 'wow' }],
        [1.5, { eyeShape: 'smiling' }]
      ]
    };
    const start = base();
    expect(showAt(start, clip, 0).eyeShape).toBe('neutral');
    expect(showAt(start, clip, 0.5).mouth).toBe('closed');
    expect(showAt(start, clip, 1.2).mouth).toBe('wow');
    expect(showAt(start, clip, 1.6).eyeShape).toBe('smiling');
    expect(start.eyeShape).toBe('orig');
  });
});

describe('eyeState', () => {
  it('подмигивание закрывает один глаз', () => {
    const shown = { ...base(), wink: 'l' as const };
    expect(eyeState(shown, 'l').st).toBe('closed');
    expect(eyeState(shown, 'r').st).toBe('open');
  });

  it('на глазах-галочках белка и зрачок выключены, на smiling — нет', () => {
    for (const eyeShape of ['happy', 'laugh']) {
      const eye = eyeState({ ...base(), eyes: 'open', eyeShape, iris: 'orig' });
      expect(eye.useShape).toBe(true);
      expect(eye.whiteOn).toBe(false);
    }
    const smile = eyeState({ ...base(), eyes: 'open', eyeShape: 'smiling', iris: 'orig' });
    expect(smile.useShape).toBe(true);
    expect(smile.whiteOn).toBe(true);
    const open = eyeState({ ...base(), eyes: 'open', eyeShape: 'angry', iris: 'orig' });
    expect(open.whiteOn).toBe(true);
  });
});

describe('shouldAutoBlink', () => {
  it('не моргает в клипах с noBlink', () => {
    const clip: RigClip = { len: 1, loop: false, noBlink: true, bones: {}, set: [] };
    expect(shouldAutoBlink(base(), clip)).toBe(false);
    expect(shouldAutoBlink(base(), { ...clip, noBlink: false })).toBe(true);
  });

  it('не моргает на весёлых и сонных глазах', () => {
    expect(shouldAutoBlink({ ...base(), eyeShape: 'happy' }, null)).toBe(false);
    expect(shouldAutoBlink({ ...base(), eyeShape: 'sleepy' }, null)).toBe(false);
  });
});

describe('Blinker', () => {
  it('закрывает и открывает глаз за один цикл', () => {
    const blinker = new Blinker();
    expect(blinker.active).toBe(false);
    blinker.begin(0);
    expect(blinker.active).toBe(true);
    expect(blinker.value(0)).toBeCloseTo(1);
    expect(blinker.value(80)).toBeCloseTo(0.08);
    expect(blinker.value(150)).toBeGreaterThan(0.08);
    expect(blinker.value(150)).toBeLessThan(1);
    expect(blinker.value(209)).not.toBeNull();
    expect(blinker.value(210)).toBeNull();
    expect(blinker.active).toBe(false);
  });

  it('фактор моргания не выходит из диапазона', () => {
    for (const ms of [0, 30, 59, 99, 150, 209]) {
      expect(blinkFactor(ms)).toBeGreaterThanOrEqual(0);
      expect(blinkFactor(ms)).toBeLessThanOrEqual(1);
    }
  });
});

describe('emptyShow', () => {
  it('даёт открытые глаза и спокойное лицо', () => {
    const shown = emptyShow();
    expect(shown.eyes).toBe('open');
    expect(shown.fx).toEqual([]);
  });
});
