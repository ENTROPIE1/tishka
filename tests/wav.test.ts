import { describe, expect, it } from 'vitest';
import { encodeWav, normalizePeak, resample, wavDurationSec } from '../src/voice/wav';

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

describe('normalizePeak', () => {
  it('поднимает пик тихой записи до 0,9', () => {
    const result = normalizePeak(new Float32Array([0.05, -0.05, 0.025]));
    expect(Math.max(...result.map(Math.abs))).toBeCloseTo(0.9, 5);
  });

  it('усиление ограничено двадцатью', () => {
    const result = normalizePeak(new Float32Array([0.001]));
    expect(result[0]).toBeCloseTo(0.02, 5);
  });

  it('тишину не усиливает', () => {
    const samples = new Float32Array([0.0005, -0.0002, 0]);
    const result = normalizePeak(samples);
    expect(Array.from(result)).toEqual(Array.from(samples));
  });
});

describe('wavDurationSec', () => {
  it('считает длительность записи своего кодировщика', () => {
    const wav = encodeWav(new Float32Array(32000), 16000);
    expect(wavDurationSec(wav)).toBeCloseTo(2, 3);
  });

  it('учитывает частоту из заголовка, а не из предположений', () => {
    const wav = encodeWav(new Float32Array(144000), 48000);
    expect(wavDurationSec(wav)).toBeCloseTo(3, 3);
  });

  it('допускает лишние чанки перед data', () => {
    const base = encodeWav(new Float32Array(16000), 8000);
    const list = new Uint8Array(8 + 10);
    list.set([0x4c, 0x49, 0x53, 0x54], 0);   // LIST
    new DataView(list.buffer).setUint32(4, 10, true);
    const head = base.subarray(0, 36);   // всё до чанка data
    const combined = new Uint8Array(head.length + list.length + (base.length - 36));
    combined.set(head, 0);
    combined.set(list, head.length);
    combined.set(base.subarray(36), head.length + list.length);
    new DataView(combined.buffer).setUint32(4, combined.length - 8, true);
    expect(wavDurationSec(combined)).toBeCloseTo(2, 3);
  });

  it('короткий и не-WAV файл дают ноль', () => {
    expect(wavDurationSec(new Uint8Array([1, 2, 3]))).toBe(0);
    expect(wavDurationSec(new Uint8Array(64))).toBe(0);
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
