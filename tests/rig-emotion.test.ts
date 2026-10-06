import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { emptyShow, mergeEmotions, parseModel, type RigEmote, type RigEmotion, type RigLayer, type RigShow } from '../src/renderer/character-rig/rig-data';
import { RigEmotionState, resolveMood } from '../src/renderer/character-rig/rig-emotion';
import { emptyPose } from '../src/renderer/character-rig/rig-pose';
import { layerVisible } from '../src/renderer/character-rig/rig-show';
import { moodHints, isKnownMood } from '../src/core/agent/moods';

const modelDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'tishka', 'model');

const anger: RigEmotion = { ru: 'злость', eyes: 'open', eyeShape: 'angry', brows: 'angry', mouth: 'sad', ears: [-18, 18], head: [0, 2], fx: ['vein'] };
const surprise: RigEmotion = { ru: 'удивление', eyeShape: 'surprised', mouth: 'wow', ears: [10, -10], head: [0, -2], browY: -9, fx: [] };
const nod: RigEmote = {
  ru: 'кивает',
  len: 1,
  bones: { head: [[0, 0, 0, 0], [0.5, 0, 0, 6], [1, 0, 0, 0]] },
  face: [[0, { mouth: 'm_e' }], [0.5, { brows: 'kind' }]],
  fx: ['sparkles']
};
const giggle: RigEmote = { ru: 'хохочет', len: 1, loop: true, bones: { ear_l: [[0, 0], [1, 10]] }, face: [], fx: [] };

function data() {
  return { emotions: { anger, surprise }, emotes: { nod, giggle }, emotionFx: ['vein', 'sweat', 'sparkles'] };
}

function show(patch: Partial<RigShow> = {}): RigShow {
  return { ...emptyShow(), ...patch };
}

// Много мелких шагов кадра, чтобы плавная поза дошла до цели.
function settle(state: RigEmotionState, from: number, ms: number): number {
  let now = from;
  for (let t = 0; t < ms; t += 16) {
    now += 16;
    state.step(now);
  }
  return now;
}

describe('RigEmotionState: лицо', () => {
  it('без эмоции лицо идёт по клипу', () => {
    const state = new RigEmotionState(data());
    const clipFace = show({ brows: 'focused', fx: ['gear'] });
    expect(state.face(clipFace)).toEqual(clipFace);
  });

  it('эмоция заменяет части лица и значки эмоции, значки действия остаются', () => {
    const state = new RigEmotionState(data());
    state.setEmotion('anger');
    const face = state.face(show({ brows: 'kind', mouth: 'm_a', fx: ['gear', 'sweat'] }));
    expect(face.eyeShape).toBe('angry');
    expect(face.brows).toBe('angry');
    expect(face.mouth).toBe('sad');
    expect(face.fx.sort()).toEqual(['gear', 'vein']);
  });

  it('закрытые клипом глаза (сон) эмоция не открывает', () => {
    const state = new RigEmotionState(data());
    state.setEmotion('anger');
    expect(state.face(show({ eyes: 'closed' })).eyes).toBe('closed');
  });

  it('незнакомая эмоция не ставится', () => {
    const state = new RigEmotionState(data());
    expect(state.setEmotion('nope')).toBe(false);
    expect(state.emotion).toBeNull();
  });
});

describe('RigEmotionState: уши, голова, брови', () => {
  it('плавно подходят к позе эмоции и складываются с клипом', () => {
    const state = new RigEmotionState(data());
    state.setEmotion('surprise');
    state.step(0);
    const first = state.pose(emptyPose());
    expect(Math.abs(first.rot['ear_l'] ?? 0)).toBeLessThan(10);
    settle(state, 0, 1500);
    const clip = emptyPose();
    clip.rot['head'] = 5;
    clip.trans['head'] = { x: 1, y: 1, s: 1 };
    const pose = state.pose(clip);
    expect(pose.rot['ear_l']).toBeCloseTo(10, 1);
    expect(pose.rot['ear_r']).toBeCloseTo(-10, 1);
    expect(pose.rot['head']).toBeCloseTo(5, 1);
    expect(pose.trans['head']?.y).toBeCloseTo(-1, 1);
    expect(pose.trans['head']?.x).toBe(1);
    expect(pose.trans['brow_l']?.y).toBeCloseTo(-9, 1);
    expect(clip.rot['ear_l']).toBeUndefined();
  });

  it('после сброса возвращаются к нулю', () => {
    const state = new RigEmotionState(data());
    state.setEmotion('anger');
    let now = settle(state, 0, 1500);
    state.setEmotion(null);
    now = settle(state, now, 1500);
    expect(state.pose(emptyPose()).rot['ear_l'] ?? 0).toBeCloseTo(0, 1);
  });
});

describe('RigEmotionState: сценки', () => {
  it('сценка меняет лицо по времени, добавляет значки и кончается сама', () => {
    const state = new RigEmotionState(data());
    expect(state.playEmote('nod', 1000)).toBe(true);
    state.step(1100);
    let face = state.face(show());
    expect(face.mouth).toBe('m_e');
    expect(face.brows).toBe('orig');
    expect(face.fx).toContain('sparkles');
    state.step(1500);
    face = state.face(show());
    expect(face.brows).toBe('kind');
    expect(state.pose(emptyPose()).trans['head']?.y).toBeCloseTo(6, 5);
    state.step(2100);
    expect(state.emoteName).toBeNull();
    expect(state.face(show()).mouth).toBe('closed');
  });

  it('повторяемая сценка идёт по кругу до остановки', () => {
    const state = new RigEmotionState(data());
    state.playEmote('giggle', 0);
    state.step(5250);
    expect(state.emoteName).toBe('giggle');
    expect(state.pose(emptyPose()).rot['ear_l']).toBeCloseTo(1.46, 1);   // четверть круга, плавно
    state.stopEmote();
    expect(state.emoteName).toBeNull();
  });

  it('новая эмоция снимает повторяемую сценку, обычная доигрывает', () => {
    const state = new RigEmotionState(data());
    state.playEmote('giggle', 0);
    state.stopLoopingEmote();
    expect(state.emoteName).toBeNull();
    state.playEmote('nod', 0);
    state.stopLoopingEmote();
    expect(state.emoteName).toBe('nod');
  });

  it('незнакомая сценка не запускается', () => {
    expect(new RigEmotionState(data()).playEmote('nope', 0)).toBe(false);
  });
});

describe('resolveMood', () => {
  const model = { ...data(), moodEmotion: { neutral: 'calm', happy: 'surprise' } };

  it('neutral — лицо по клипу, сценка и эмоция по имени, настроение ответа через MOOD_EMOTION', () => {
    expect(resolveMood(model, 'neutral')).toEqual({ kind: 'reset' });
    expect(resolveMood(model, 'nod')).toEqual({ kind: 'emote', name: 'nod' });
    expect(resolveMood(model, 'anger')).toEqual({ kind: 'emotion', name: 'anger' });
    expect(resolveMood(model, 'happy')).toEqual({ kind: 'emotion', name: 'surprise' });
    expect(resolveMood(model, 'nope')).toEqual({ kind: 'legacy' });
  });

  it('модель без эмоций работает по-старому', () => {
    expect(resolveMood({}, 'neutral')).toEqual({ kind: 'legacy' });
  });
});

describe('полуприкрытые веки', () => {
  const white = (lid: string): RigLayer => ({ id: `w_${lid}`, src: '', bone: 'eye_l', eyePart: 'white', side: 'l', shape: 'orig', lid });
  const line = (lid: string): RigLayer => ({ id: `l_${lid}`, src: '', bone: 'eye_l', eyePart: 'line', side: 'l', shape: 'orig', lid });
  const hl: RigLayer = { id: 'hl', src: '', bone: 'iris_l', eyePart: 'hl', side: 'l', iris: 'orig' };
  const layers = [white('open'), white('half'), line('open'), line('half'), hl];

  it('показывают свой белок и контур, без блика', () => {
    const half = show({ eyes: 'half' });
    expect(layers.filter((l) => layerVisible(l, half, layers)).map((l) => l.id)).toEqual(['w_half', 'l_half']);
    const open = show({ eyes: 'open' });
    expect(layers.filter((l) => layerVisible(l, open, layers)).map((l) => l.id)).toEqual(['w_open', 'l_open', 'hl']);
  });
});

describe('эмоции в модели', () => {
  it('правки из rig.json главнее emotions.js', () => {
    const merged = mergeEmotions({ anger }, { anger: { ears: [-30, 30] } });
    expect(merged['anger']?.ears).toEqual([-30, 30]);
    expect(merged['anger']?.eyeShape).toBe('angry');
  });

  it('model.json несёт эмоции и сценки, moods.json знает их имена', () => {
    const model = parseModel(readFileSync(join(modelDir, 'model.json'), 'utf8'));
    expect(Object.keys(model.emotions ?? {})).toContain('joy');
    expect(Object.keys(model.emotes ?? {})).toContain('nod');
    expect(isKnownMood('joy')).toBe(true);
    expect(isKnownMood('nod')).toBe(true);
    expect(isKnownMood('happy')).toBe(true);
    const hints = moodHints();
    expect(hints.emotions).toContain('joy — радость');
    expect(hints.emotes).toContain('nod — кивает');
    expect(hints.emotions.some((h) => h.startsWith('happy'))).toBe(false);
  });
});
