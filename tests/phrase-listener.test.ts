import { describe, expect, it } from 'vitest';
import type { MicCapture } from '../src/renderer/shared/mic-capture';
import { createPhraseListener } from '../src/renderer/shared/phrase-listener';
import { wavDurationSec } from '../src/voice/wav';

const RATE = 16000;
const FRAME_SAMPLES = 320;   // 20 мс при 16 000 Гц

interface FakeMic {
  mic: MicCapture;
  feed(value: number, ms: number): void;
}

function fakeMic(): FakeMic {
  let handler: ((frame: Float32Array, rate: number) => void) | undefined;
  const mic: MicCapture = {
    async start(onFrame): Promise<boolean> {
      handler = onFrame;
      return true;
    },
    stop(): void {
      handler = undefined;
    }
  };
  return {
    mic,
    feed(value, ms): void {
      const frames = Math.round(ms / 20);
      for (let i = 0; i < frames; i += 1) {
        handler?.(new Float32Array(FRAME_SAMPLES).fill(value), RATE);
      }
    }
  };
}

function rmsLevel(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    sum += samples[i] * samples[i];
  }
  return samples.length === 0 ? 0 : Math.sqrt(sum / samples.length);
}

// Раскодирует WAV 16 бит моно обратно в отсчёты.
function decodeWav(wav: Uint8Array): Float32Array {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = String.fromCharCode(wav[offset], wav[offset + 1], wav[offset + 2], wav[offset + 3]);
    const size = view.getUint32(offset + 4, true);
    if (id === 'data') {
      const start = offset + 8;
      const count = Math.floor(Math.min(size, wav.length - start) / 2);
      const result = new Float32Array(count);
      for (let i = 0; i < count; i += 1) {
        const raw = view.getInt16(start + i * 2, true);
        result[i] = raw / (raw < 0 ? 0x8000 : 0x7fff);
      }
      return result;
    }
    offset += 8 + size + (size % 2);
  }
  return new Float32Array();
}

interface Emission {
  wav: Uint8Array;
  limitHit: boolean;
}

function mount(inConversation: () => boolean): {
  mic: FakeMic;
  emitted: Emission[];
  start(): Promise<boolean>;
} {
  const captured = fakeMic();
  const emitted: Emission[] = [];
  const instance = createPhraseListener({
    threshold: 0.004,
    chunkMs: 4000,
    chunkOverlapMs: 500,
    inConversation,
    capture: captured.mic,
    onPhrase: (wav, limitHit) => {
      emitted.push({ wav, limitHit });
    }
  });
  return { mic: captured, emitted, start: () => instance.start() };
}

describe('phrase-listener: отрезки прослушивания имени', () => {
  it('звук ниже порога не создаёт отрезков', async () => {
    const mounted = mount(() => false);
    await mounted.start();
    mounted.mic.feed(0.003, 6000);
    expect(mounted.emitted).toHaveLength(0);
  });

  it('длинный звук режется на отрезки по 4 секунды', async () => {
    const mounted = mount(() => false);
    await mounted.start();
    mounted.mic.feed(0.02, 9600);
    expect(mounted.emitted.length).toBeGreaterThanOrEqual(2);
    for (const item of mounted.emitted) {
      expect(item.limitHit).toBe(true);
      expect(wavDurationSec(item.wav)).toBeGreaterThan(3);
      expect(wavDurationSec(item.wav)).toBeLessThan(5);
    }
  });

  it('следующий отрезок начинается с перекрытием 0,5 секунды', async () => {
    const mounted = mount(() => false);
    await mounted.start();
    // Тихий звук выше порога шесть секунд, затем громкий — граница на 6-й секунде.
    // Уровни подобраны так, чтобы оба отрезка усиливались одинаково.
    mounted.mic.feed(0.005, 6000);
    mounted.mic.feed(0.03, 6000);
    expect(mounted.emitted.length).toBeGreaterThanOrEqual(2);
    const window = Math.floor(RATE * 0.4);
    const second = decodeWav(mounted.emitted[1].wav);
    const first = decodeWav(mounted.emitted[0].wav);
    // Начало второго отрезка повторяет конец первого: тихий звук до границы.
    expect(rmsLevel(second.slice(0, window))).toBeCloseTo(rmsLevel(first.slice(first.length - window)), 1);
    expect(rmsLevel(second.slice(0, window))).toBeLessThan(rmsLevel(second.slice(second.length - window)));
  });

  it('в разговоре предел реплики остаётся прежним', async () => {
    const mounted = mount(() => true);
    await mounted.start();
    mounted.mic.feed(0.02, 11000);
    expect(mounted.emitted).toHaveLength(0);
    mounted.mic.feed(0.02, 3000);
    expect(mounted.emitted.length).toBe(1);
    expect(mounted.emitted[0].limitHit).toBe(false);
    expect(wavDurationSec(mounted.emitted[0].wav)).toBeGreaterThan(11);
    expect(wavDurationSec(mounted.emitted[0].wav)).toBeLessThan(14);
  });
});
