import { describe, expect, it, vi } from 'vitest';
import { createLlmClient, LlmError } from '../src/core/llm/client';
import { CancelledError } from '../src/core/cancel';

const baseUrl = 'https://llm.example.test/v1';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init
  });
}

function choice(text: string): Response {
  return jsonResponse({ choices: [{ message: { content: text } }] });
}

function bodyOf(call: unknown[]): { model: string } {
  const init = call[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body)) as { model: string };
}

function makeClient(
  fetchMock: typeof fetch,
  options: { now?: () => number; onFallback?: (info: { from: string; to: string; reason: string }) => void } = {}
) {
  return createLlmClient({
    baseUrl,
    getApiKey: async () => 'test-key',
    fetch: fetchMock,
    fallbackModel: (model) => (model === 'main' ? 'backup' : undefined),
    fallbackWindowMs: 5 * 60_000,
    now: options.now,
    onFallback: options.onFallback
  });
}

describe('отказ основной модели и запасная', () => {
  it('500 основной — ответ с запасной, переход отмечен один раз', async () => {
    const onFallback = vi.fn();
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }));
    fetchMock.mockResolvedValueOnce(choice('ответ запасной'));
    const client = makeClient(fetchMock, { now: () => 0, onFallback });

    const response = await client.chat({ model: 'main', messages: [{ role: 'user', content: 'привет' }] });

    expect(response.text).toBe('ответ запасной');
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledWith({ from: 'main', to: 'backup', reason: 'server' });
    expect(bodyOf(fetchMock.mock.calls[0])).toMatchObject({ model: 'main' });
    expect(bodyOf(fetchMock.mock.calls[1])).toMatchObject({ model: 'backup' });
  });

  it('502 основной — тоже переход на запасную', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(new Response('', { status: 502 }));
    fetchMock.mockResolvedValueOnce(choice('ответ запасной'));
    const client = makeClient(fetchMock);

    const response = await client.chat({ model: 'main', messages: [{ role: 'user', content: 'привет' }] });

    expect(response.text).toBe('ответ запасной');
  });

  it('401 — перехода нет', async () => {
    const onFallback = vi.fn();
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('', { status: 401 }));
    const client = makeClient(fetchMock, { onFallback });

    const error = (await client
      .chat({ model: 'main', messages: [{ role: 'user', content: 'привет' }] })
      .catch((caught: unknown) => caught)) as LlmError;

    expect(error).toBeInstanceOf(LlmError);
    expect(error.kind).toBe('auth');
    expect(onFallback).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('429 — перехода нет', async () => {
    const onFallback = vi.fn();
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('', { status: 429 }));
    const client = makeClient(fetchMock, { onFallback });

    const error = (await client
      .chat({ model: 'main', messages: [{ role: 'user', content: 'привет' }] })
      .catch((caught: unknown) => caught)) as LlmError;

    expect(error.kind).toBe('limit');
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('обе отказали — ошибка вида server', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }));
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }));
    const client = makeClient(fetchMock);

    const error = (await client
      .chat({ model: 'main', messages: [{ role: 'user', content: 'привет' }] })
      .catch((caught: unknown) => caught)) as LlmError;

    expect(error).toBeInstanceOf(LlmError);
    expect(error.kind).toBe('server');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('пять минут запросы идут на запасную, потом возвращается основная', async () => {
    let clock = 0;
    const onFallback = vi.fn();
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }));
    fetchMock.mockResolvedValueOnce(choice('запасная 1'));
    fetchMock.mockResolvedValueOnce(choice('запасная 2'));
    fetchMock.mockResolvedValueOnce(choice('основная снова'));
    const client = makeClient(fetchMock, { now: () => clock, onFallback });

    const first = await client.chat({ model: 'main', messages: [{ role: 'user', content: '1' }] });
    expect(first.text).toBe('запасная 1');

    clock = 60_000;
    const second = await client.chat({ model: 'main', messages: [{ role: 'user', content: '2' }] });
    expect(second.text).toBe('запасная 2');
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock.mock.calls[2])).toMatchObject({ model: 'backup' });

    clock = 5 * 60_000 + 1;
    const third = await client.chat({ model: 'main', messages: [{ role: 'user', content: '3' }] });
    expect(third.text).toBe('основная снова');
    expect(bodyOf(fetchMock.mock.calls[3])).toMatchObject({ model: 'main' });
  });

  it('отмена человеком не вызывает перехода', async () => {
    const onFallback = vi.fn();
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.signal?.aborted === true) {
        throw new DOMException('aborted', 'AbortError');
      }
      return choice('не должно случиться');
    });
    const client = makeClient(fetchMock, { onFallback });

    const error = await client
      .chat({ model: 'main', messages: [{ role: 'user', content: 'привет' }], signal: controller.signal })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CancelledError);
    expect(onFallback).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('исчерпанный бюджет — отдельная ошибка без ключа и почты', async () => {
    const body = 'exceeded budget for key id sk-abcdef123 email user@example.test';
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(body, { status: 429 }));
    const client = makeClient(fetchMock);

    const error = (await client
      .chat({ model: 'main', messages: [{ role: 'user', content: 'привет' }] })
      .catch((caught: unknown) => caught)) as LlmError;

    expect(error).toBeInstanceOf(LlmError);
    expect(error.kind).toBe('limit');
    expect(error.budget).toBe(true);
    expect(error.message).not.toContain('sk-abcdef123');
    expect(error.message).not.toContain('user@example.test');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('модель картинок использует свою запасную', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }));
    fetchMock.mockResolvedValueOnce(choice('vision backup'));
    const client = createLlmClient({
      baseUrl,
      getApiKey: async () => 'test-key',
      fetch: fetchMock,
      fallbackModel: (model) => (model === 'vision' ? 'vision-backup' : undefined)
    });

    const response = await client.chat({ model: 'vision', messages: [{ role: 'user', content: 'смотри' }] });

    expect(response.text).toBe('vision backup');
    expect(bodyOf(fetchMock.mock.calls[1])).toMatchObject({ model: 'vision-backup' });
  });
});
