import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEventBus } from '../src/core/events';
import type { TishkaEvent } from '../src/core/types';
import { createVad, type Vad } from '../src/voice/vad';
import { createPhraseListener } from '../src/renderer/shared/phrase-listener';
import type { MicCapture, MicFrameHandler } from '../src/renderer/shared/mic-capture';
import { createPetListen } from '../src/main/pet-listen';
import { flush, makeHarness, wav } from './wake-test-helpers';

const FRAME_MS = 20;

function frame(value: number): Float32Array {
  return new Float32Array(320).fill(value);
}

function feed(vad: Vad, value: number, count: number): void {
  for (let i = 0; i < count; i += 1) {
    vad.push(frame(value), FRAME_MS);
  }
}

describe('детектор речи: короткие щелчки', () => {
  it('серия импульсов 20–40 мс с промежутками речью не считается', () => {
    const vad = createVad({ continuous: true, noSpeechMs: 0, settleMs: 0 });
    for (let i = 0; i < 20; i += 1) {
      feed(vad, 0.8, 1);
      feed(vad, 0.002, 2);
    }
    expect(vad.heardSpeech()).toBe(false);
  });

  it('слитная речь 250 мс считается речью', () => {
    const vad = createVad({ continuous: true, noSpeechMs: 0, settleMs: 0 });
    feed(vad, 0.002, 15);
    feed(vad, 0.012, 13);
    expect(vad.heardSpeech()).toBe(true);
  });
});

describe('wake-flow: пустой отклик распознавания', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('в разговоре пустой текст не даёт ошибки, прослушивание продолжается', async () => {
    const h = makeHarness([{ error: 'Не расслышал', empty: true }]);
    h.flow.enableConversation();
    h.flow.handlePhrase(wav);
    await flush();
    expect(h.errors).toEqual([]);
    expect(h.flow.isConversation()).toBe(true);
    expect(h.calls).toEqual([]);
  });

  it('пустой текст не продлевает таймер тишины разговора', async () => {
    const h = makeHarness([{ error: 'Не расслышал', empty: true }]);
    h.flow.enableConversation();
    await vi.advanceTimersByTimeAsync(20000);
    h.flow.handlePhrase(wav);
    await flush();
    await vi.advanceTimersByTimeAsync(11000);
    expect(h.flow.isConversation()).toBe(false);
  });
});

describe('pet-listen: ручное нажатие микрофона', () => {
  it('пустой отклик после ручного микрофона даёт «Не расслышал»', async () => {
    const bus = createEventBus();
    const events: TishkaEvent[] = [];
    bus.on((event) => events.push(event));
    const listen = createPetListen({
      bus,
      core: { handleUserText: async () => ({ say: 'ок' }) } as never,
      stt: { status: () => 'ready', transcribe: async () => ({ ok: false, error: 'Не расслышал', empty: true }) } as never,
      sendCommand: () => undefined
    });
    listen.toggle('click');
    listen.handleResult({ kind: 'wav', data: new Uint8Array([1, 2]) });
    await Promise.resolve();
    await Promise.resolve();
    expect(events.some((event) => event.type === 'error' && event.message === 'Не расслышал')).toBe(true);
  });
});

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
        handler?.(new Float32Array(320).fill(value), 16000);
      }
    }
  };
}

describe('phrase-listener: пауза на время набора', () => {
  it('начатая фраза отбрасывается, после снятия паузы запись работает', async () => {
    const mic = fakeMic();
    const phrases: Uint8Array[] = [];
    const listener = createPhraseListener({
      onPhrase: (value) => phrases.push(value),
      capture: mic.capture,
      silenceMs: 800,
      maxPhraseMs: 12000
    });
    await listener.start();

    mic.push(0.1, 30);
    listener.pause();
    mic.push(0.1, 30);
    listener.resume();
    mic.push(0.002, 60);
    expect(phrases).toHaveLength(0);

    mic.push(0.1, 50);
    mic.push(0.002, 60);
    expect(phrases).toHaveLength(1);
  });
});
