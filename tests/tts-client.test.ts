import { describe, expect, it, vi } from 'vitest';
import { createTtsClient } from '../src/voice/tts-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

describe('tts-client: health', () => {
  it('возвращает движок и голос', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ status: 'ok', engine: 'silero', voice: 'baya' }));
    const client = createTtsClient({ url: 'http://127.0.0.1:8179/', fetch: fetchMock as unknown as typeof fetch });
    await expect(client.health()).resolves.toEqual({ ok: true, engine: 'silero', voice: 'baya' });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8179/health', expect.anything());
  });

  it('сообщает об ошибке службы', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 503));
    const client = createTtsClient({ url: 'http://127.0.0.1:8179', fetch: fetchMock as unknown as typeof fetch });
    const result = await client.health();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('503');
    }
  });
});

describe('tts-client: synthesize', () => {
  it('возвращает wav', async () => {
    const bytes = new Uint8Array([82, 73, 70, 70]);
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(bytes, { status: 200 }));
    const client = createTtsClient({ url: 'http://127.0.0.1:8179', fetch: fetchMock as unknown as typeof fetch });
    const result = await client.synthesize('привет');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect([...result.wav]).toEqual([82, 73, 70, 70]);
    }
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ text: 'привет' }));
  });

  it('ошибка на конкретный текст — not unreachable', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 500));
    const client = createTtsClient({ url: 'http://127.0.0.1:8179', fetch: fetchMock as unknown as typeof fetch });
    const result = await client.synthesize('привет');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('500');
      expect(result.kind).toBe('rejected');
    }
  });

  it('503 — служба недоступна', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 503));
    const client = createTtsClient({ url: 'http://127.0.0.1:8179', fetch: fetchMock as unknown as typeof fetch });
    const result = await client.synthesize('привет');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('unreachable');
    }
  });

  it('сообщает о таймауте', async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        })
    );
    const client = createTtsClient({
      url: 'http://127.0.0.1:8179',
      fetch: fetchMock as unknown as typeof fetch,
      timeoutMs: 10
    });
    const result = await client.synthesize('привет');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('вовремя');
    }
  });

  it('понятная ошибка при недоступной службе', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const client = createTtsClient({ url: 'http://127.0.0.1:8179', fetch: fetchMock as unknown as typeof fetch });
    const result = await client.synthesize('привет');
    expect(result).toEqual({
      ok: false,
      error: 'Не удалось обратиться к службе синтеза',
      kind: 'unreachable'
    });
  });
});
