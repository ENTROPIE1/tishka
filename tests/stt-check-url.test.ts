import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkSttUrl, PROBE_TIMEOUT_MS } from '../src/voice/stt-http';

afterEach(() => {
  vi.useRealTimers();
});

describe('checkSttUrl', () => {
  it('отвечающая служба: ok и время ответа', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      vi.setSystemTime(1042);
      return new Response('', { status: 200 });
    });

    const result = await checkSttUrl(fetchMock as unknown as typeof fetch, 'http://127.0.0.1:8178');

    expect(result).toEqual({ ok: true, ms: 42 });
    expect(fetchMock.mock.calls[0][0]).toBe('http://127.0.0.1:8178/');
  });

  it('служба не ответила вовремя — причина timeout', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));

    const promise = checkSttUrl(fetchMock as unknown as typeof fetch, 'http://127.0.0.1:8178');
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS);

    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toContain('вовремя');
  });

  it('служба недоступна — причина в отказе', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('connection refused');
    });

    const result = await checkSttUrl(fetchMock as unknown as typeof fetch, 'http://127.0.0.1:8178');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('не отвечает');
  });

  it('служба ответила с ошибкой — статус в причине', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 503 }));

    const result = await checkSttUrl(fetchMock as unknown as typeof fetch, 'http://127.0.0.1:8178');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('503');
  });
});
