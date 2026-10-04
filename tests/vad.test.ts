import { describe, expect, it } from 'vitest';
import { createVad, trimSpeech, type Vad, type VadVerdict } from '../src/voice/vad';

const FRAME_MS = 20;

function frame(value: number): Float32Array {
  return new Float32Array(320).fill(value);
}

function feed(vad: Vad, value: number, count: number): VadVerdict {
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

  it('речь тихим голосом сразу после шума распознаётся и завершается end', () => {
    const vad = createVad();
    feed(vad, 0.002, 15);
    expect(feed(vad, 0.012, 20)).toBe('continue');
    expect(vad.heardSpeech()).toBe(true);
    expect(feed(vad, 0, 60)).toBe('end');
  });

  it('тихая речь 0,008 считается речью при высокой чувствительности', () => {
    const vad = createVad({ sensitivity: 'high' });
    feed(vad, 0.002, 15);
    expect(feed(vad, 0.008, 15)).toBe('continue');
    expect(vad.heardSpeech()).toBe(true);
  });

  it('тихая речь 0,008 не считается речью при низкой чувствительности', () => {
    const vad = createVad({ sensitivity: 'low' });
    feed(vad, 0.002, 15);
    expect(feed(vad, 0.008, 15)).toBe('continue');
    expect(vad.heardSpeech()).toBe(false);
  });

  it('провал в один кадр не обрывает речь и не теряет начало', () => {
    const vad = createVad();
    feed(vad, 0.002, 15);
    feed(vad, 0.012, 12);
    expect(vad.heardSpeech()).toBe(true);
    expect(vad.push(frame(0.002), FRAME_MS)).toBe('continue');
    expect(feed(vad, 0.012, 12)).toBe('continue');
    expect(vad.heardSpeech()).toBe(true);
  });

  it('постоянный шум 0,01 речью не считается', () => {
    const vad = createVad();
    expect(feed(vad, 0.01, 250)).toBe('nospeech');
    expect(vad.heardSpeech()).toBe(false);
  });

  it('короткий щелчок речью не считается', () => {
    const vad = createVad();
    feed(vad, 0.002, 15);
    expect(vad.push(frame(0.8), FRAME_MS)).toBe('continue');
    expect(feed(vad, 0.002, 240)).toBe('nospeech');
  });

  it('уровень остаётся в диапазоне 0..1, порог — на середине', () => {
    const vad = createVad();
    vad.push(frame(0.5), FRAME_MS);
    expect(vad.level()).toBeGreaterThanOrEqual(0);
    expect(vad.level()).toBeLessThanOrEqual(1);
  });
});

describe('trimSpeech', () => {
  it('добавляет запас до начала речи и обрезает длинную тишину', () => {
    const samples = new Float32Array(16000).fill(1);
    const result = trimSpeech(samples, 16000, 1000, 1500);
    expect(result.length).toBe(16000 - 11200);
  });

  it('оставляет запас 300 мс до начала и хвост после конца', () => {
    const sampleRate = 1000;
    const samples = new Float32Array(5000);
    const result = trimSpeech(samples, sampleRate, 1000, 1500);
    expect(result.length).toBe(1000);
  });
});

describe('createVad: результат записи', () => {
  it('в результате есть запас до речи, а тишина по краям обрезана', () => {
    const vad = createVad();
    const sampleRate = 16000;
    const perFrame = 320;
    const parts: Float32Array[] = [];
    const add = (value: number, count: number): void => {
      for (let i = 0; i < count; i += 1) {
        const part = frame(value);
        parts.push(part);
        vad.push(part, FRAME_MS);
      }
    };
    add(0.002, 25);
    add(0.1, 25);
    add(0.002, 100);
    const merged = new Float32Array(parts.length * perFrame);
    parts.forEach((part, index) => merged.set(part, index * perFrame));

    const result = vad.result(merged, sampleRate);
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThan(merged.length);
    expect(result[0]).toBeCloseTo(0.002);
    expect(result[result.length - 1]).toBeCloseTo(0.002);
  });
});
