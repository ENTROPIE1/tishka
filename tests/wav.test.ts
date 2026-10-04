import { describe, expect, it } from 'vitest';
import { encodeWav, resample } from '../src/voice/wav';

function ascii(view: DataView, offset: number, length: number): string {
  let text = '';
  for (let i = 0; i < length; i += 1) {
    text += String.fromCharCode(view.getUint8(offset + i));
  }
  return text;
}

describe('encodeWav', () => {
  it('пишет заголовок RIFF/WAVE, 16 бит, моно, с нужной частотой и длиной данных', () => {
    const samples = new Float32Array(100);
    const wav = encodeWav(samples, 16000);
    const view = new DataView(wav.buffer);

    expect(wav.length).toBe(44 + samples.length * 2);
    expect(ascii(view, 0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + samples.length * 2);
    expect(ascii(view, 8, 4)).toBe('WAVE');
    expect(ascii(view, 12, 4)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(view, 36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
  });

  it('ограничивает отсчёты и переводит их в int16', () => {
    const wav = encodeWav(new Float32Array([1, -1, 0]), 16000);
    const view = new DataView(wav.buffer);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
    expect(view.getInt16(48, true)).toBe(0);
  });
});

describe('resample', () => {
  it('48 000 → 16 000 даёт треть отсчётов', () => {
    const samples = new Float32Array(48000);
    const result = resample(samples, 48000, 16000);
    expect(result.length).toBe(16000);
  });

  it('без изменения частоты возвращает копию', () => {
    const samples = new Float32Array([0.1, 0.2, 0.3]);
    const result = resample(samples, 16000, 16000);
    expect(result.length).toBe(3);
    expect(result[0]).toBeCloseTo(0.1);
    expect(result[1]).toBeCloseTo(0.2);
    expect(result[2]).toBeCloseTo(0.3);
  });
});
