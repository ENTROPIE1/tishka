import { describe, expect, it, vi } from 'vitest';
import { createSpeechQueue, type SpeechItem } from '../src/voice/speech-queue';

function item(text: string): SpeechItem {
  return { text, wav: new Uint8Array([text.length]) };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve();
  }
}

function makePlayer(): {
  play: (item: SpeechItem, signal: AbortSignal) => Promise<void>;
  started: string[];
  finish: () => void;
} {
  const started: string[] = [];
  const resolvers: Array<() => void> = [];
  const play = (speech: SpeechItem, signal: AbortSignal): Promise<void> => {
    started.push(speech.text);
    return new Promise<void>((resolve) => {
      resolvers.push(resolve);
      signal.addEventListener('abort', () => resolve());
    });
  };
  return {
    play,
    started,
    finish: () => {
      resolvers.shift()?.();
    }
  };
}

describe('speech-queue', () => {
  it('новая реплика ждёт текущую', async () => {
    const player = makePlayer();
    const queue = createSpeechQueue({ play: player.play });
    queue.enqueue(item('a'));
    expect(player.started).toEqual(['a']);
    queue.enqueue(item('b'));
    expect(player.started).toEqual(['a']);
    player.finish();
    await flush();
    expect(player.started).toEqual(['a', 'b']);
  });

  it('больше двух ожидающих — старые отбрасываются', async () => {
    const player = makePlayer();
    const queue = createSpeechQueue({ play: player.play });
    queue.enqueue(item('a'));
    queue.enqueue(item('b'));
    queue.enqueue(item('c'));
    queue.enqueue(item('d'));
    player.finish();
    await flush();
    expect(player.started).toEqual(['a', 'c']);
  });

  it('stop очищает очередь и прерывает текущую', async () => {
    const player = makePlayer();
    const onEnd = vi.fn();
    const queue = createSpeechQueue({ play: player.play, onEnd });
    queue.enqueue(item('a'));
    queue.enqueue(item('b'));
    queue.stop();
    await flush();
    expect(player.started).toEqual(['a']);
    expect(queue.isSpeaking()).toBe(false);
    expect(onEnd).toHaveBeenCalled();
  });

  it('сообщает о начале и конце речи', async () => {
    const player = makePlayer();
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const queue = createSpeechQueue({ play: player.play, onStart, onEnd });
    queue.enqueue(item('a'));
    expect(onStart).toHaveBeenCalledWith('a');
    player.finish();
    await flush();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});
