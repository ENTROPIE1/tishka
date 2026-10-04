import { describe, expect, it } from 'vitest';
import { createVad, type VadVerdict } from '../src/voice/vad';

const FRAME_MS = 20;

function frame(value: number): Float32Array {
  return new Float32Array(320).fill(value);
}

function feed(vad: { push(frame: Float32Array, frameMs: number): VadVerdict }, value: number, count: number): VadVerdict {
  let verdict: VadVerdict = 'continue';
  for (let i = 0; i < count; i += 1) {
    verdict = vad.push(frame(value), FRAME_MS);
    if (verdict !== 'continue') {
      return verdict;
    }
  }
  return verdict;
}

describe('createVad', () => {
  it('тишина 5 секунд даёт nospeech', () => {
    const vad = createVad();
    expect(feed(vad, 0, 250)).toBe('nospeech');
  });

  it('речь, затем 1,2 секунды тишины даёт end', () => {
    const vad = createVad();
    expect(feed(vad, 0, 15)).toBe('continue');
    expect(feed(vad, 0.5, 25)).toBe('continue');
    expect(feed(vad, 0, 60)).toBe('end');
  });

  it('непрерывная речь 15 секунд даёт timeout', () => {
    const vad = createVad();
    feed(vad, 0, 15);
    expect(feed(vad, 0.5, 800)).toBe('timeout');
  });

  it('короткий щелчок речью не считается', () => {
    const vad = createVad();
    feed(vad, 0, 15);
    expect(vad.push(frame(0.8), FRAME_MS)).toBe('continue');
    expect(feed(vad, 0, 240)).toBe('nospeech');
  });

  it('уровень остаётся в диапазоне 0..1', () => {
    const vad = createVad();
    vad.push(frame(0.5), FRAME_MS);
    expect(vad.level()).toBeGreaterThanOrEqual(0);
    expect(vad.level()).toBeLessThanOrEqual(1);
  });
});
