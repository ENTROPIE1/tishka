import { afterEach, describe, expect, it, vi } from 'vitest';
import { probe, PROBE_TIMEOUT_MS } from '../src/voice/stt-http';
import { configWith, makeChild, service } from './stt-test-helpers';

afterEach(() => {
  vi.useRealTimers();
});

function hangingFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(() => new Promise<Response>(() => undefined));
}

describe('probe: предел времени', () => {
  it('завершается по сроку при зависшем запросе и снимает таймер', async () => {
    vi.useFakeTimers();
    const fetchMock = hangingFetch();
    const promise = probe(fetchMock as unknown as typeof fetch, 'http://127.0.0.1:8178');

    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS);

    await expect(promise).resolves.toBe(false);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'GET' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('живой ответ возвращает true и снимает таймер', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response('', { status: 200 }));

    await expect(probe(fetchMock as unknown as typeof fetch, 'http://127.0.0.1:8178')).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('createSttService.start: зависающий probe', () => {
  it('готовность за 30 секунд выдерживается, даже если запрос завис', async () => {
    vi.useFakeTimers();
    const { child, kill } = makeChild();
    const spawn = vi.fn(() => child);
    const fetchMock = vi.fn();
    fetchMock.mockRejectedValueOnce(new Error('connection refused'));
    fetchMock.mockImplementation(() => new Promise<Response>(() => undefined));
    const stt = service(() => configWith('C:\\w\\whisper.exe'), spawn, fetchMock);

    const promise = stt.start();
    await vi.advanceTimersByTimeAsync(31_000);
    const result = await promise;

    expect(result.ok).toBe(false);
    expect(result.error).toContain('30 секунд');
    expect(kill).toHaveBeenCalled();
    expect(stt.status()).toBe('error');
  });
});
