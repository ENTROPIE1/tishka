import { describe, expect, it } from 'vitest';
import { envelope } from '../src/voice/envelope';

const SAMPLE_RATE = 16000;

describe('envelope', () => {
  it('тишина даёт нули', () => {
    const samples = new Float32Array(SAMPLE_RATE);
    const values = envelope(samples, SAMPLE_RATE, 50);
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((value) => value === 0)).toBe(true);
  });

  it('синусоида даёт почти постоянное значение в 0–1', () => {
    const samples = new Float32Array(SAMPLE_RATE);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = Math.sin((2 * Math.PI * 440 * index) / SAMPLE_RATE);
    }
    const values = envelope(samples, SAMPLE_RATE, 50);
    expect(values.length).toBe(SAMPLE_RATE / 800);
    expect(values.every((value) => value >= 0 && value <= 1)).toBe(true);
    const min = Math.min(...values);
    const max = Math.max(...values);
    expect(max - min).toBeLessThan(0.05);
    expect(min).toBeGreaterThan(0.6);
  });

  it('пустой сигнал и некорректные параметры дают пусто', () => {
    expect(envelope([], SAMPLE_RATE, 50)).toEqual([]);
    expect(envelope([1, 2], 0, 50)).toEqual([]);
    expect(envelope([1, 2], SAMPLE_RATE, 0)).toEqual([]);
  });
});
