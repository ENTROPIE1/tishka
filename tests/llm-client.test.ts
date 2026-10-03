import { describe, expect, it, vi } from 'vitest';
import { createLlmClient, LlmError, type ChatMessage } from '../src/core/llm/client';
import type { ToolDef } from '../src/core/types';

const baseUrl = 'https://llm.example.test/v1';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init
  });
}

function choice(message: Record<string, unknown>): Response {
  return jsonResponse({ choices: [{ message }] });
}

function createClient(fetchImpl: typeof fetch, apiKey: string | undefined = 'test-key') {
  return createLlmClient({
    baseUrl,
    getApiKey: async () => apiKey,
    fetch: fetchImpl
  });
}

describe('createLlmClient', () => {
  it('разбирает текстовый ответ в text', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => choice({ content: 'Привет' }));
    const client = createClient(fetchMock);

    const response = await client.chat({ model: 'm', messages: [{ role: 'user', content: 'привет' }] });

    expect(response.text).toBe('Привет');
    expect(response.toolCalls).toEqual([]);
  });

  it('разбирает вызов инструмента в toolCalls с объектом аргументов', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      choice({
        content: null,
        tool_calls: [
          { id: 'call-1', type: 'function', function: { name: 'get_time', arguments: '{"city":"Москва"}' } }
        ]
      })
    );
    const client = createClient(fetchMock);

    const response = await client.chat({ model: 'm', messages: [{ role: 'user', content: 'время' }] });

    expect(response.text).toBeNull();
    expect(response.toolCalls).toEqual([{ id: 'call-1', name: 'get_time', args: { city: 'Москва' } }]);
  });

  it('неразбираемые аргументы дают args: {}', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      choice({
        content: null,
        tool_calls: [{ id: 'call-2', type: 'function', function: { name: 'get_time', arguments: '{это не json' } }]
      })
    );
    const client = createClient(fetchMock);

    const response = await client.chat({ model: 'm', messages: [{ role: 'user', content: 'время' }] });

    expect(response.toolCalls).toEqual([{ id: 'call-2', name: 'get_time', args: {} }]);
  });

  it('при 429 повторяет запрос и достигает успеха', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '0' } }));
    fetchMock.mockResolvedValueOnce(choice({ content: 'Готово' }));
    const client = createClient(fetchMock);

    const response = await client.chat({ model: 'm', messages: [{ role: 'user', content: 'привет' }] });

    expect(response.text).toBe('Готово');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('три неудачи подряд дают LlmError вида limit', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response('', { status: 429, headers: { 'Retry-After': '0' } })
    );
    const client = createClient(fetchMock);

    const error = await client
      .chat({ model: 'm', messages: [{ role: 'user', content: 'привет' }] })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).kind).toBe('limit');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('при 401 даёт LlmError вида auth без повторов', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('', { status: 401 }));
    const client = createClient(fetchMock);

    const error = await client
      .chat({ model: 'm', messages: [{ role: 'user', content: 'привет' }] })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).kind).toBe('auth');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('без ключа даёт LlmError вида auth', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => choice({ content: 'ок' }));
    const client = createLlmClient({ baseUrl, getApiKey: async () => undefined, fetch: fetchMock });

    const error = await client
      .chat({ model: 'm', messages: [{ role: 'user', content: 'привет' }] })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).kind).toBe('auth');
    expect((error as LlmError).message).toBe('Не задан ключ шлюза моделей');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('отправляет картинку как image_url со строкой data:', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => choice({ content: 'вижу' }));
    const client = createClient(fetchMock);
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'что на картинке' },
          { type: 'image', dataUrl: 'data:image/png;base64,AAAA' }
        ]
      }
    ];

    await client.chat({ model: 'm', messages });

    const init = fetchMock.mock.calls[0][1];
    const body = JSON.parse(String(init?.body)) as {
      messages: { content: { type: string; image_url?: { url: string } }[] }[];
    };
    const parts = body.messages[0].content;
    expect(parts[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } });
  });

  it('не кладёт ключ в текст ошибки', async () => {
    const secret = 'super-secret-token';
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('Unauthorized', { status: 401 }));
    const client = createClient(fetchMock, secret);

    const error = (await client
      .chat({ model: 'm', messages: [{ role: 'user', content: 'привет' }] })
      .catch((caught: unknown) => caught)) as LlmError;

    expect(error.message).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
  });

  it('переводит ToolDef в формат functions', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => choice({ content: 'ок' }));
    const client = createClient(fetchMock);
    const tools: ToolDef[] = [
      {
        name: 'get_time',
        description: 'Текущее время',
        inputSchema: { type: 'object', properties: {} },
        source: 'builtin',
        readOnly: true
      }
    ];

    await client.chat({ model: 'm', messages: [{ role: 'user', content: 'время' }], tools });

    const init = fetchMock.mock.calls[0][1];
    const body = JSON.parse(String(init?.body)) as { tools: unknown[] };
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: { name: 'get_time', description: 'Текущее время', parameters: { type: 'object', properties: {} } }
      }
    ]);
  });
});
