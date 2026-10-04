// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSpeaker } from '../src/renderer/pet/speaker';
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

function makeContext(): { FakeContext: unknown; decodes: Decode[]; sources: FakeSource[] } {
  const decodes: Decode[] = [];
  const sources: FakeSource[] = [];
  class FakeContext {
    destination = {};
    currentTime = 0;
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
  return { FakeContext, decodes, sources };
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
});
