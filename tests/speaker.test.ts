// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSpeaker } from '../src/renderer/pet/speaker';
import type { MouthTrack } from '../src/voice/lipsync';
import type { SpeakMessage } from '../src/voice/speech-queue';

class FakeSource {
  onended: (() => void) | null = null;
  connect(): FakeSource {
    return this;
  }
  start(): void {}
  stop(): void {}
}

class FakeGain {
  gain = { value: 0 };
  connect(): void {}
}

interface Decode {
  resolve(buffer: unknown): void;
  reject(error: unknown): void;
}

interface FakeContextInstance {
  currentTime: number;
}

function makeContext(): {
  FakeContext: unknown;
  decodes: Decode[];
  sources: FakeSource[];
  instances: FakeContextInstance[];
} {
  const decodes: Decode[] = [];
  const sources: FakeSource[] = [];
  const instances: FakeContextInstance[] = [];
  class FakeContext {
    destination = {};
    currentTime = 0;
    constructor() {
      instances.push(this);
    }
    resume(): Promise<void> {
      return Promise.resolve();
    }
    decodeAudioData(): Promise<unknown> {
      return new Promise<unknown>((resolve, reject) => {
        decodes.push({ resolve, reject });
      });
    }
    createBufferSource(): FakeSource {
      const source = new FakeSource();
      sources.push(source);
      return source;
    }
    createGain(): FakeGain {
      return new FakeGain();
    }
  }
  return { FakeContext, decodes, sources, instances };
}

function buffer(): unknown {
  return { getChannelData: () => new Float32Array(0), sampleRate: 16000 };
}

function message(id: number): SpeakMessage {
  return { wav: new Uint8Array([1, 2, 3, 4]), volume: 1, id };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve();
  }
}

describe('speaker', () => {
  let context: ReturnType<typeof makeContext>;

  beforeEach(() => {
    context = makeContext();
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = context.FakeContext;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('stop во время декодирования даёт ровно один onDone', async () => {
    const onDone = vi.fn();
    const speaker = createSpeaker({ setMouth: () => undefined, onDone });

    speaker.play(message(7));
    await flush();
    speaker.stop();
    context.decodes[0]?.resolve(buffer());
    await flush();

    expect(onDone).toHaveBeenCalledOnce();
    expect(onDone).toHaveBeenCalledWith(7);
  });

  it('stop после начала воспроизведения завершает play', async () => {
    const onDone = vi.fn();
    const speaker = createSpeaker({ setMouth: () => undefined, onDone });

    speaker.play(message(1));
    await flush();
    context.decodes[0]?.resolve(buffer());
    await flush();
    expect(onDone).not.toHaveBeenCalled();

    speaker.stop();
    expect(onDone).toHaveBeenCalledOnce();

    speaker.stop();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('второй play вытесняет первый, каждый завершается один раз', async () => {
    const onDone = vi.fn();
    const speaker = createSpeaker({ setMouth: () => undefined, onDone });

    speaker.play(message(1));
    await flush();
    context.decodes[0]?.resolve(buffer());
    await flush();

    speaker.play(message(2));
    expect(onDone).toHaveBeenCalledWith(1);

    await flush();
    context.decodes[1]?.resolve(buffer());
    await flush();
    context.sources[1]?.onended?.();

    expect(onDone.mock.calls.map((call) => call[0])).toEqual([1, 2]);
  });

  it('ошибка декодирования завершает play', async () => {
    const onDone = vi.fn();
    const speaker = createSpeaker({ setMouth: () => undefined, onDone });

    speaker.play(message(3));
    await flush();
    context.decodes[0]?.reject(new Error('bad wav'));
    await flush();

    expect(onDone).toHaveBeenCalledOnce();
    expect(onDone).toHaveBeenCalledWith(3);
  });

  it('рот по дорожке идёт по времени звука, пауза не сбивает', async () => {
    const shapes: (string | null)[] = [];
    const mouth: MouthTrack = { fps: 60, frames: 120, mouth: [[0, 'm_a'], [60, 'm_o']] };
    const speaker = createSpeaker({ setMouth: () => undefined, setViseme: (shape) => shapes.push(shape), onDone: () => undefined });

    speaker.play({ wav: new Uint8Array([1, 2, 3, 4]), volume: 1, id: 1, mouth });
    await flush();
    context.decodes[0]?.resolve(buffer());
    await flush();

    const audio = context.instances[0];
    audio.currentTime = 0;
    vi.advanceTimersByTime(33);
    audio.currentTime = 0.5;
    vi.advanceTimersByTime(33);
    // пауза: время звука стоит — форма не меняется
    vi.advanceTimersByTime(33);
    audio.currentTime = 1.1;
    vi.advanceTimersByTime(33);

    expect(shapes).toContain('m_a');
    expect(shapes[shapes.length - 1]).toBe('m_o');
  });

  it('настроение ответа применяется в начале звука', async () => {
    const moods: string[] = [];
    const speaker = createSpeaker({
      setMouth: () => undefined,
      setViseme: () => undefined,
      setMood: (name) => moods.push(name),
      onDone: () => undefined
    });

    speaker.play({ wav: new Uint8Array([1, 2, 3, 4]), volume: 1, id: 4, mood: 'confused' });
    await flush();
    context.decodes[0]?.resolve(buffer());
    await flush();

    expect(moods).toEqual(['confused']);
  });

  it('без настроения ответа лицо возвращается к neutral', async () => {
    const moods: string[] = [];
    const speaker = createSpeaker({
      setMouth: () => undefined,
      setViseme: () => undefined,
      setMood: (name) => moods.push(name),
      onDone: () => undefined
    });

    speaker.play(message(5));
    await flush();
    context.decodes[0]?.resolve(buffer());
    await flush();

    expect(moods).toEqual(['neutral']);
  });

  it('эмоция применяется по времени звука, последняя остаётся', async () => {
    const moods: string[] = [];
    const mouth: MouthTrack = { fps: 60, frames: 120, mouth: [[0, 'm_a']] };
    const speaker = createSpeaker({
      setMouth: () => undefined,
      setViseme: () => undefined,
      setMood: (name) => moods.push(name),
      onDone: () => undefined
    });

    speaker.play({
      wav: new Uint8Array([1, 2, 3, 4]),
      volume: 1,
      id: 2,
      mouth,
      mood: 'confused',
      moods: [{ at: 0.5, mood: 'happy' }]
    });
    await flush();
    context.decodes[0]?.resolve(buffer());
    await flush();

    const audio = context.instances[0];
    audio.currentTime = 0.1;
    vi.advanceTimersByTime(33);
    expect(moods).toEqual(['confused']);
    audio.currentTime = 0.6;
    vi.advanceTimersByTime(33);
    expect(moods).toEqual(['confused', 'happy']);
    speaker.stop();
    expect(moods).toEqual(['confused', 'happy']);
  });
});
