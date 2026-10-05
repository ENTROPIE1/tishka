import { describe, expect, it } from 'vitest';
import { createPhraseQueue } from '../src/voice/stale-phrase';
import type { TranscribeResult } from '../src/voice/stt-service';

const wav = new Uint8Array([1, 2, 3, 4]);

async function flush(): Promise<void> {
  for (let step = 0; step < 8; step += 1) {
    await Promise.resolve();
  }
}

describe('createPhraseQueue: медленное распознавание не копит очередь', () => {
  it('пока идёт распознавание первого отрезка, ждёт только последний', async () => {
    const resolvers: Array<(result: TranscribeResult) => void> = [];
    const recognized: string[] = [];
    const dropped: string[] = [];
    const queue = createPhraseQueue({
      accept: () => true,
      transcribe: () =>
        new Promise<TranscribeResult>((resolve) => {
          resolvers.push(resolve);
        }),
      onResult: (result) => {
        if (result.ok) {
          recognized.push(result.text);
        }
      },
      mark: (event, details) => {
        if (event === 'stt.drop') {
          dropped.push(String(details?.['reason'] ?? ''));
        }
      }
    });

    queue.add(wav, 1);
    // Пока первый распознаётся, приходят второй и третий: второй вытеснен.
    queue.add(wav, 2);
    queue.add(wav, 3);
    expect(dropped).toEqual(['busy']);
    expect(resolvers).toHaveLength(1);

    resolvers[0]({ ok: true, text: 'первый' });
    await flush();

    // После первого стартовал последний ожидающий, среднего нет.
    expect(resolvers).toHaveLength(2);
    resolvers[1]({ ok: true, text: 'третий' });
    await flush();

    expect(recognized).toEqual(['первый', 'третий']);
    expect(dropped).toEqual(['busy']);
  });
});
