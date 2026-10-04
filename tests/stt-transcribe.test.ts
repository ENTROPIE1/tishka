import { describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/core/types';
import { createSttService } from '../src/voice/stt-service';

function voice(): Config['voice'] {
  return {
    hotkey: 'Control+Alt+Space',
    wakeWords: ['тишка'],
    wakeEnabled: false,
    talkByDefault: true,
    talkTimeoutSec: 30,
    sensitivity: 'normal',
    mic: { threshold: null, noise: null, speech: null, calibratedAt: null },
    sttUrl: 'http://127.0.0.1:8178',
    stt: { exe: '', model: '', audioCtx: 768, threads: 4 },
    tts: { enabled: false, url: 'http://127.0.0.1:8179', volume: 1 }
  };
}

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

function service(fetchMock: ReturnType<typeof vi.fn>) {
  return createSttService({
    getConfig: () => voice(),
    fetch: fetchMock as unknown as typeof fetch
  });
}

describe('createSttService.transcribe', () => {
  it('отправляет форму с файлом и возвращает очищенный текст', async () => {
    const fetchMock = vi.fn(async () => okResponse({ text: ' [музыка]  Тишка,\n привет ' }));
    const stt = service(fetchMock);

    const result = await stt.transcribe(new Uint8Array([1, 2, 3, 4]));

    expect(result).toEqual({ ok: true, text: 'Тишка, привет' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8178/inference');
    expect(init.method).toBe('POST');
    const form = init.body as FormData;
    expect(form.get('response_format')).toBe('verbose_json');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('подробный ответ с высокой вероятностью отсутствия речи — «Не расслышал»', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({
        text: 'видишь?',
        segments: [{ text: 'видишь?', no_speech_prob: 0.9, avg_logprob: -0.2 }]
      })
    );
    const stt = service(fetchMock);

    await expect(stt.transcribe(new Uint8Array([1, 2]))).resolves.toEqual({
      ok: false,
      error: 'Не расслышал',
      empty: true
    });
  });

  it('подробный ответ с низкой средней уверенностью — «Не расслышал»', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({
        text: 'раз',
        segments: [{ text: 'раз', no_speech_prob: 0.1, avg_logprob: -2.5 }]
      })
    );
    const stt = service(fetchMock);

    await expect(stt.transcribe(new Uint8Array([1, 2]))).resolves.toEqual({
      ok: false,
      error: 'Не расслышал',
      empty: true
    });
  });

  it('уверенный подробный ответ возвращает текст', async () => {
    const fetchMock = vi.fn(async () =>
      okResponse({
        text: 'включи музыку',
        segments: [{ text: 'включи музыку', no_speech_prob: 0.05, avg_logprob: -0.3 }]
      })
    );
    const stt = service(fetchMock);

    await expect(stt.transcribe(new Uint8Array([1, 2]))).resolves.toEqual({ ok: true, text: 'включи музыку' });
  });

  it('ответ без подробных полей возвращает текст как раньше', async () => {
    const fetchMock = vi.fn(async () => okResponse({ text: 'привет' }));
    const stt = service(fetchMock);

    await expect(stt.transcribe(new Uint8Array([1, 2]))).resolves.toEqual({ ok: true, text: 'привет' });
  });

  it('служба без поддержки подробного ответа: повтор с обычным форматом', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const form = init.body as FormData;
      if (form.get('response_format') === 'verbose_json') {
        return new Response('', { status: 400 });
      }
      return okResponse({ text: 'привет' });
    });
    const stt = service(fetchMock as unknown as ReturnType<typeof vi.fn>);

    await expect(stt.transcribe(new Uint8Array([1, 2]))).resolves.toEqual({ ok: true, text: 'привет' });
    const secondForm = (fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body as FormData;
    expect(secondForm.get('response_format')).toBe('json');
  });

  it('пустой ответ — ошибка «Не расслышал»', async () => {
    const fetchMock = vi.fn(async () => okResponse({ text: '   ' }));
    const stt = service(fetchMock);

    await expect(stt.transcribe(new Uint8Array([1]))).resolves.toEqual({
      ok: false,
      error: 'Не расслышал',
      empty: true
    });
  });

  it('сбой сети даёт понятную ошибку', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network down');
    });
    const stt = service(fetchMock);

    await expect(stt.transcribe(new Uint8Array([1]))).resolves.toEqual({
      ok: false,
      error: 'Не удалось обратиться к службе распознавания'
    });
  });
});
