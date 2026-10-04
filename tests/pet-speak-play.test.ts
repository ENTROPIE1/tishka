import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPetSpeakPlay } from '../src/main/pet-speak-play';
import type { SpeakMessage } from '../src/voice/speech-queue';

function message(): SpeakMessage {
  return { wav: new Uint8Array([1, 2, 3, 4]), volume: 1 };
}

function setup(): {
  speak: ReturnType<typeof vi.fn>;
  stopSpeaking: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof createPetSpeakPlay>;
} {
  const speak = vi.fn<(value: SpeakMessage) => void>();
  const stopSpeaking = vi.fn();
  return { speak, stopSpeaking, play: createPetSpeakPlay({ speak, stopSpeaking }) };
}

function sentId(speak: ReturnType<typeof vi.fn>, index: number): number | undefined {
  const call = speak.mock.calls[index];
  return call === undefined ? undefined : (call[0] as SpeakMessage).id;
}

async function flush(): Promise<void> {
  for (let index = 0; index < 4; index += 1) {
    await Promise.resolve();
  }
}

describe('pet-speak-play', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('завершается по speak-done', async () => {
    const { speak, play } = setup();
    const promise = play.play(message(), new AbortController().signal);

    play.done(sentId(speak, 0));
    await promise;

    expect(speak).toHaveBeenCalledOnce();
  });

  it('завершается по abort сигнала и просит остановить звук', async () => {
    const { stopSpeaking, play } = setup();
    const controller = new AbortController();
    const promise = play.play(message(), controller.signal);

    controller.abort();
    await promise;

    expect(stopSpeaking).toHaveBeenCalledOnce();
  });

  it('завершается по страховочному сроку', async () => {
    vi.useFakeTimers();
    const { stopSpeaking, play } = setup();
    const promise = play.play(message(), new AbortController().signal);

    await vi.advanceTimersByTimeAsync(60000);
    await promise;

    expect(stopSpeaking).toHaveBeenCalledOnce();
  });

  it('запоздавшее speak-done прежнего звука не завершает следующий', async () => {
    const { speak, play } = setup();
    const first = play.play(message(), new AbortController().signal);
    const firstId = sentId(speak, 0);

    const second = play.play(message(), new AbortController().signal);
    const secondId = sentId(speak, 1);
    await first;

    let secondSettled = false;
    void second.then(() => {
      secondSettled = true;
    });

    play.done(firstId);
    await flush();
    expect(secondSettled).toBe(false);

    play.done(secondId);
    await second;
    expect(secondSettled).toBe(true);
  });

  it('перезагрузка окна завершает ожидающее обещание', async () => {
    const { play } = setup();
    const promise = play.play(message(), new AbortController().signal);

    play.abort();
    await promise;
  });
});
