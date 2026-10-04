import { describe, expect, it } from 'vitest';
import { createPhraseListener } from '../src/renderer/shared/phrase-listener';
import type { MicCapture, MicFrameHandler } from '../src/renderer/shared/mic-capture';

const SAMPLE_RATE = 16000;
const FRAME_SAMPLES = 320; // 20 мс
const FRAME_MS = (FRAME_SAMPLES / SAMPLE_RATE) * 1000;

interface FakeMic {
  capture: MicCapture;
  push(value: number, count: number): void;
}

function fakeMic(): FakeMic {
  let handler: MicFrameHandler | undefined;
  return {
    capture: {
      async start(onFrame: MicFrameHandler): Promise<boolean> {
        handler = onFrame;
        return true;
      },
      stop(): void {
        handler = undefined;
      }
    },
    push(value: number, count: number): void {
      for (let i = 0; i < count; i += 1) {
        handler?.(new Float32Array(FRAME_SAMPLES).fill(value), SAMPLE_RATE);
      }
    }
  };
}

function decode(wav: Uint8Array): Float32Array {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const length = (wav.length - 44) / 2;
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    samples[i] = view.getInt16(44 + i * 2, true) / 32768;
  }
  return samples;
}

async function setup(): Promise<{ mic: FakeMic; phrases: Uint8Array[] }> {
  const mic = fakeMic();
  const phrases: Uint8Array[] = [];
  const listener = createPhraseListener({
    onPhrase: (wav) => phrases.push(wav),
    capture: mic.capture,
    silenceMs: 800,
    maxPhraseMs: 12000
  });
  await listener.start();
  return { mic, phrases };
}

describe('createPhraseListener', () => {
  it('30 секунд тишины — ни одной отправленной фразы', async () => {
    const { mic, phrases } = await setup();
    mic.push(0.002, Math.round(30000 / FRAME_MS));
    expect(phrases).toHaveLength(0);
  });

  it('усиленная тишина не отправляется', async () => {
    const { mic, phrases } = await setup();
    mic.push(0.0005, Math.round(30000 / FRAME_MS));
    expect(phrases).toHaveLength(0);
  });

  it('фраза, начатая на одиннадцатой секунде молчания, отправлена целиком', async () => {
    const { mic, phrases } = await setup();
    mic.push(0.002, Math.round(11000 / FRAME_MS));
    mic.push(0.1, Math.round(2000 / FRAME_MS));
    mic.push(0.002, Math.round(2000 / FRAME_MS));

    expect(phrases).toHaveLength(1);
    const samples = decode(phrases[0]);
    expect(samples.length / SAMPLE_RATE).toBeGreaterThan(2);
    expect(samples.length / SAMPLE_RATE).toBeLessThan(4);
  });

  it('две фразы подряд распознаются без повторной калибровки', async () => {
    const { mic, phrases } = await setup();
    mic.push(0.002, 50);
    mic.push(0.1, 50);
    mic.push(0.002, 60);
    mic.push(0.002, 20);
    mic.push(0.1, 50);
    mic.push(0.002, 60);

    expect(phrases).toHaveLength(2);
  });

  it('в записи есть запас до начала речи', async () => {
    const { mic, phrases } = await setup();
    mic.push(0.004, 50);
    mic.push(0.1, 50);
    mic.push(0.004, 60);

    expect(phrases).toHaveLength(1);
    const samples = decode(phrases[0]);
    expect(samples.length).toBeGreaterThan(1);
    const peak = Math.max(...Array.from(samples, (value) => Math.abs(value)));
    const first = Math.abs(samples[0]);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(peak);
  });
});
