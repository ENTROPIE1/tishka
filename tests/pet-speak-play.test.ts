import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPetSpeakPlay, speakTimeoutMs } from '../src/main/pet-speak-play';
import { encodeWav } from '../src/voice/wav';
import type { SpeakMessage } from '../src/voice/speech-queue';

function message(): SpeakMessage {
  return { wav: new Uint8Array([1, 2, 3, 4]), volume: 1 };
}

// Запись заданной длины: частота 16 000 Гц, как в синтезе.
function recording(seconds: number): Uint8Array {
  return encodeWav(new Float32Array(16000 * seconds), 16000);
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

  it('завершается по страховочному сроку: длина записи плюс запас', async () => {
    vi.useFakeTimers();
    const { stopSpeaking, play } = setup();
    const promise = play.play({ wav: recording(10), volume: 1 }, new AbortController().signal);

    await vi.advanceTimersByTimeAsync(14999);
    let settled = false;
    void promise.then(() => {
      settled = true;
    });
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await promise;

    expect(stopSpeaking).toHaveBeenCalledOnce();
  });

  it('длинная реплика не обрывается прежним сроком в минуту', async () => {
    vi.useFakeTimers();
    const { stopSpeaking, play } = setup();
    const promise = play.play({ wav: recording(70), volume: 1 }, new AbortController().signal);

    await vi.advanceTimersByTimeAsync(60000);
    let settled = false;
    void promise.then(() => {
      settled = true;
    });
    expect(settled).toBe(false);
    expect(stopSpeaking).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(15000);
    await promise;

    expect(stopSpeaking).toHaveBeenCalledOnce();
  });

  it('срок не бывает меньше пятнадцати секунд', async () => {
    vi.useFakeTimers();
    const { stopSpeaking, play } = setup();
    const promise = play.play({ wav: recording(2), volume: 1 }, new AbortController().signal);

    await vi.advanceTimersByTimeAsync(14000);
    let settled = false;
    void promise.then(() => {
      settled = true;
    });
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    expect(stopSpeaking).toHaveBeenCalledOnce();
  });

  it('неопознанный звук звучит минимум пятнадцать секунд', async () => {
    vi.useFakeTimers();
    const { play } = setup();
    const promise = play.play(message(), new AbortController().signal);

    let settled = false;
    void promise.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(14000);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1000);
    await promise;
  });

  it('срок считается из длины звука', () => {
    expect(speakTimeoutMs(recording(10))).toBe(15000);
    expect(speakTimeoutMs(recording(3))).toBe(15000);
    expect(speakTimeoutMs(recording(70))).toBe(75000);
    expect(speakTimeoutMs(new Uint8Array([1, 2, 3]))).toBe(15000);
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
