import { describe, expect, it, vi } from 'vitest';
import { checkGateway, normalizeBaseUrl } from '../src/core/llm/check';

const baseUrl = 'https://llm.example.test/v1';
const API_KEY = 'super-secret-token';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function modelsResponse(names: string[]): Response {
  return jsonResponse({ data: names.map((id) => ({ id })) });
}

function chatResponse(): Response {
  return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
}

function urlOf(input: RequestInfo | URL): string {
  return String(input);
}

describe('normalizeBaseUrl', () => {
  it('убирает завершающие косые', () => {
    expect(normalizeBaseUrl('  https://llm.example.test/v1/  ')).toEqual({
      ok: true,
      value: 'https://llm.example.test/v1'
    });
  });

  it('отбрасывает хвост /chat/completions', () => {
    expect(normalizeBaseUrl('https://llm.example.test/v1/chat/completions')).toEqual({
      ok: true,
      value: 'https://llm.example.test/v1'
    });
    expect(normalizeBaseUrl('https://llm.example.test/v1/chat/completions/')).toEqual({
      ok: true,
      value: 'https://llm.example.test/v1'
    });
  });

  it('без схемы даёт ошибку с подсказкой', () => {
    const result = normalizeBaseUrl('llm.example.test/v1');
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain('http://');
  });
});

describe('checkGateway', () => {
  it('успешная проверка возвращает список моделей', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) =>
      urlOf(input).endsWith('/models') ? modelsResponse(['alpha', 'beta']) : chatResponse()
    );

    const result = await checkGateway(
      { baseUrl, model: 'alpha', apiKey: API_KEY },
      { fetch: fetchMock }
    );

    expect(result.ok).toBe(true);
    expect(result.models).toEqual(['alpha', 'beta']);
    expect(result.error).toBeUndefined();
    expect(result.ms).toBeGreaterThanOrEqual(0);
  });

  it('шлюз без /models не считается ошибкой', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) =>
      urlOf(input).endsWith('/models') ? new Response('', { status: 404 }) : chatResponse()
    );

    const result = await checkGateway(
      { baseUrl, model: 'alpha', apiKey: API_KEY },
      { fetch: fetchMock }
    );

    expect(result.ok).toBe(true);
    expect(result.models).toEqual([]);
  });

  it('401 даёт понятную ошибку', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('', { status: 401 }));

    const result = await checkGateway(
      { baseUrl, model: 'alpha', apiKey: API_KEY },
      { fetch: fetchMock }
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Ключ шлюза не принят');
  });

  it('модели нет в непустом списке — ошибка без запроса к чату', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) =>
      urlOf(input).endsWith('/models') ? modelsResponse(['alpha', 'beta']) : chatResponse()
    );

    const result = await checkGateway(
      { baseUrl, model: 'ghost', apiKey: API_KEY },
      { fetch: fetchMock }
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Модели «ghost» нет на шлюзе');
    expect(result.models).toEqual(['alpha', 'beta']);
    const chatCalls = fetchMock.mock.calls.filter(([input]) => urlOf(input).endsWith('/chat/completions'));
    expect(chatCalls).toHaveLength(0);
  });

  it.each([401, 403])('отказ %i на чате при полученном списке — модель недоступна', async (status) => {
    const fetchMock = vi.fn<typeof fetch>(async (input) =>
      urlOf(input).endsWith('/models') ? modelsResponse(['alpha']) : new Response('', { status })
    );

    const result = await checkGateway(
      { baseUrl, model: 'alpha', apiKey: API_KEY },
      { fetch: fetchMock }
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Модель «alpha» недоступна для этого ключа');
  });

  it('отказ на чате без списка моделей — ключ не принят', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) =>
      urlOf(input).endsWith('/models') ? new Response('', { status: 404 }) : new Response('', { status: 401 })
    );

    const result = await checkGateway(
      { baseUrl, model: 'alpha', apiKey: API_KEY },
      { fetch: fetchMock }
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Ключ шлюза не принят');
  });

  it('неизвестная модель распознаётся по 404', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) =>
      urlOf(input).endsWith('/models') ? modelsResponse(['alpha']) : new Response('', { status: 404 })
    );

    const result = await checkGateway(
      { baseUrl, model: 'ghost', apiKey: API_KEY },
      { fetch: fetchMock }
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain('ghost');
  });

  it('недоступный адрес даёт ошибку связи', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed');
    });

    const result = await checkGateway(
      { baseUrl, model: 'alpha', apiKey: API_KEY },
      { fetch: fetchMock }
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Шлюз недоступен по указанному адресу');
  });

  it('молчащий шлюз укладывается в срок ожидания', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        })
    );

    const result = await checkGateway(
      { baseUrl, model: 'alpha', apiKey: API_KEY },
      { fetch: fetchMock, timeoutMs: 5 }
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Шлюз не ответил за 20 секунд');
  });

  it('ключ не встречается в тексте ошибки', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) =>
      urlOf(input).endsWith('/models')
        ? modelsResponse(['ghost'])
        : jsonResponse({ error: `bad key ${API_KEY} for model ghost` }, 400)
    );

    const result = await checkGateway(
      { baseUrl, model: 'ghost', apiKey: API_KEY },
      { fetch: fetchMock }
    );

    expect(result.ok).toBe(false);
    expect(result.error).not.toContain(API_KEY);
    expect(JSON.stringify(result)).not.toContain(API_KEY);
  });
});
