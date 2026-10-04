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
    expect(form.get('response_format')).toBe('json');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('пустой ответ — ошибка «Не расслышал»', async () => {
    const fetchMock = vi.fn(async () => okResponse({ text: '   ' }));
    const stt = service(fetchMock);

    await expect(stt.transcribe(new Uint8Array([1]))).resolves.toEqual({ ok: false, error: 'Не расслышал' });
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
