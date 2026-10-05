import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../src/core/config';
import { createEventBus } from '../src/core/events';
import type { Config } from '../src/core/types';
import { createSpeechOutput, type SpeechOutput } from '../src/main/pet-speak';

const S1 = 'Первое предложение для проверки деления.';
const S2 = 'Второе предложение для проверки деления.';
const S3 = 'Третье предложение для проверки деления.';
const LONG = `${S1} ${S2} ${S3}`;

function config(): Config {
  const base = defaultConfig();
  base.voice.tts.enabled = true;
  base.voice.tts.bySentence = true;
  return base;
}

interface PendingRequest {
  id: number;
  resolve(): void;
  fail(): void;
}

interface Controllable {
  fetch: typeof fetch;
  texts: string[];
  pending: PendingRequest[];
  inFlight(): number;
  maxInFlight(): number;
}

// Служба синтеза: каждый запрос висит, пока тест сам не решит его исход.
function controllableTts(): Controllable {
  const pending: PendingRequest[] = [];
  const texts: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fetchMock = (async (url: string | URL, init?: RequestInit) => {
    if (String(url).endsWith('/health')) {
      return Response.json({ status: 'ok', engine: 'test', voice: 'test' });
    }
    const body = JSON.parse(String(init?.body)) as { text: string };
    const id = texts.length;
    texts.push(body.text);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    return await new Promise<Response>((resolve) => {
      pending.push({
        id,
        resolve(): void {
          inFlight -= 1;
          resolve(new Response(new Uint8Array([id]), { status: 200 }));
        },
        fail(): void {
          inFlight -= 1;
          resolve(new Response('{}', { status: 500 }));
        }
      });
    });
  }) as unknown as typeof fetch;
  return { fetch: fetchMock, texts, pending, inFlight: () => inFlight, maxInFlight: () => maxInFlight };
}

function harness(): {
  bus: ReturnType<typeof createEventBus>;
  tts: Controllable;
  played: number[];
  out: SpeechOutput;
} {
  const bus = createEventBus();
  const tts = controllableTts();
  const played: number[] = [];
  const out = createSpeechOutput({
    bus,
    getConfig: () => config(),
    fetch: tts.fetch,
    play: (message) => {
      played.push(message.wav[0] ?? -1);
      return Promise.resolve();
    }
  });
  return { bus, tts, played, out };
}

let active: SpeechOutput | undefined;

afterEach(() => {
  active?.dispose();
  active = undefined;
  vi.useRealTimers();
});

describe('озвучка реплики по частям', () => {
  it('реплика из трёх предложений даёт три запроса по очереди', async () => {
    vi.useFakeTimers();
    const h = harness();
    active = h.out;

    h.bus.emit({ type: 'reply', reply: { say: LONG } });
    await vi.advanceTimersByTimeAsync(0);
    h.tts.pending[0]?.resolve();
    await vi.advanceTimersByTimeAsync(0);
    h.tts.pending[1]?.resolve();
    await vi.advanceTimersByTimeAsync(200);
    h.tts.pending[2]?.resolve();
    await vi.advanceTimersByTimeAsync(200);

    expect(h.tts.texts).toEqual([S1, S2, S3]);
    expect(h.played).toEqual([0, 1, 2]);
  });

  it('звук первой части начинается до синтеза третьей', async () => {
    vi.useFakeTimers();
    const h = harness();
    active = h.out;

    h.bus.emit({ type: 'reply', reply: { say: LONG } });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.tts.texts).toEqual([S1]);

    h.tts.pending[0]?.resolve();
    await vi.advanceTimersByTimeAsync(0);

    expect(h.played).toEqual([0]);
    expect(h.tts.texts).toEqual([S1, S2]);
    expect(h.tts.texts).not.toContain(S3);
  });

  it('остановка во время первой части отменяет остальные', async () => {
    vi.useFakeTimers();
    const h = harness();
    active = h.out;

    h.bus.emit({ type: 'reply', reply: { say: LONG } });
    await vi.advanceTimersByTimeAsync(0);
    h.tts.pending[0]?.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.played).toEqual([0]);

    h.out.stopSpeaking();
    await vi.advanceTimersByTimeAsync(0);
    h.tts.pending[1]?.resolve();
    await vi.advanceTimersByTimeAsync(200);

    expect(h.played).toEqual([0]);
    expect(h.tts.texts).toEqual([S1, S2]);
  });

  it('ошибка второй части не мешает третьей', async () => {
    vi.useFakeTimers();
    const h = harness();
    active = h.out;

    h.bus.emit({ type: 'reply', reply: { say: LONG } });
    await vi.advanceTimersByTimeAsync(0);
    h.tts.pending[0]?.resolve();
    await vi.advanceTimersByTimeAsync(0);
    h.tts.pending[1]?.fail();
    await vi.advanceTimersByTimeAsync(0);

    expect(h.tts.texts).toEqual([S1, S2, S3]);

    h.tts.pending[2]?.resolve();
    await vi.advanceTimersByTimeAsync(200);
    expect(h.played).toEqual([0, 2]);
  });

  it('прогрев не идёт одновременно с живой репликой', async () => {
    vi.useFakeTimers();
    const h = harness();
    active = h.out;

    h.out.warm();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.tts.pending).toHaveLength(1);

    h.bus.emit({ type: 'reply', reply: { say: LONG } });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.tts.inFlight()).toBe(1);

    h.tts.pending[0]?.resolve();
    await vi.advanceTimersByTimeAsync(0);

    expect(h.tts.texts).toContain(S1);
    expect(h.tts.maxInFlight()).toBe(1);
  });
});
