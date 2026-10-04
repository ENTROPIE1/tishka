import { describe, expect, it, vi } from 'vitest';
import { createLlmClient, LlmError, type ChatMessage } from '../src/core/llm/client';
import type { ToolDef } from '../src/core/types';

const baseUrl = 'https://llm.example.test/v1';

function responsesOk(output: unknown[], contentType = 'application/json'): Response {
  return new Response(JSON.stringify({ output }), {
    status: 200,
    headers: { 'Content-Type': contentType }
  });
}

function completedStream(): Response {
  const event =
    'event: response.completed\ndata: {"type":"response.completed","response":' +
    '{"output":[{"type":"message","content":[{"type":"output_text","text":"Из потока"}]}]}}';
  return new Response(event, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' }
  });
}

function createClient(fetchImpl: typeof fetch, apiKey: string | undefined = 'test-key') {
  return createLlmClient({
    baseUrl,
    getApiKey: async () => apiKey,
    api: 'responses',
    fetch: fetchImpl
  });
}

describe('клиент в формате responses', () => {
  it('отправляет запрос на /responses с instructions, input, store и stream', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => responsesOk([{ type: 'message', content: [{ type: 'output_text', text: 'Привет' }] }])
    );
    const client = createClient(fetchMock);
    const messages: ChatMessage[] = [
      { role: 'system', content: 'Ты помощник' },
      { role: 'user', content: 'привет' }
    ];

    const response = await client.chat({ model: 'm', messages });

    expect(response.text).toBe('Привет');
    expect(response.toolCalls).toEqual([]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${baseUrl}/responses`);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer test-key' });
    const body = JSON.parse(String(init?.body)) as {
      instructions?: string;
      input: unknown[];
      store: boolean;
      stream: boolean;
      messages?: unknown;
    };
    expect(body.instructions).toBe('Ты помощник');
    expect(body.input).toEqual([{ role: 'user', content: [{ type: 'input_text', text: 'привет' }] }]);
    expect(body.store).toBe(false);
    expect(body.stream).toBe(false);
    expect(body.messages).toBeUndefined();
  });

  it('запрос с картинкой уходит как input_image', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => responsesOk([{ type: 'message', content: [{ type: 'output_text', text: 'вижу' }] }])
    );
    const client = createClient(fetchMock);
    const messages: ChatMessage[] = [
      { role: 'system', content: 'Смотри на экран' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'что здесь' },
          { type: 'image', dataUrl: 'data:image/jpeg;base64,BBBB' }
        ]
      }
    ];

    await client.chat({ model: 'vision', messages });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      input: { content: { type: string; image_url?: string }[] }[];
    };
    expect(body.input[0].content[1]).toEqual({ type: 'input_image', image_url: 'data:image/jpeg;base64,BBBB' });
  });

  it('инструменты уходят плоским видом, вызовы инструментов приходят из function_call', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        responsesOk([
          { type: 'reasoning', summary: [] },
          { type: 'function_call', call_id: 'c1', name: 'echo', arguments: '{"text":"раз"}' }
        ])
    );
    const client = createClient(fetchMock);
    const tools: ToolDef[] = [
      {
        name: 'echo',
        description: 'Эхо',
        inputSchema: { type: 'object', properties: {} },
        source: 'builtin',
        readOnly: true
      }
    ];

    const response = await client.chat({ model: 'm', messages: [{ role: 'user', content: 'время' }], tools });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      tools: { type: string; name: string; description: string; parameters: object }[];
    };
    expect(body.tools).toEqual([
      { type: 'function', name: 'echo', description: 'Эхо', parameters: { type: 'object', properties: {} } }
    ]);
    expect(response.text).toBeNull();
    expect(response.toolCalls).toEqual([{ id: 'c1', name: 'echo', args: { text: 'раз' } }]);
  });

  it('поток событий вместо JSON разбирается до итогового ответа', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => completedStream());
    const client = createClient(fetchMock);

    const response = await client.chat({ model: 'm', messages: [{ role: 'user', content: 'привет' }] });

    expect(response.text).toBe('Из потока');
    expect(response.toolCalls).toEqual([]);
  });

  it('повторы при 429 общие с форматом chat', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '0' } }));
    fetchMock.mockResolvedValueOnce(
      responsesOk([{ type: 'message', content: [{ type: 'output_text', text: 'Ок' }] }])
    );
    const client = createClient(fetchMock);

    const response = await client.chat({ model: 'm', messages: [{ role: 'user', content: 'привет' }] });

    expect(response.text).toBe('Ок');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('401 даёт LlmError вида auth без повторов', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('', { status: 401 }));
    const client = createClient(fetchMock);

    const error = await client
      .chat({ model: 'm', messages: [{ role: 'user', content: 'привет' }] })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).kind).toBe('auth');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('пустой output даёт ошибку bad_response', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => responsesOk([]));
    const client = createClient(fetchMock);

    const error = await client
      .chat({ model: 'm', messages: [{ role: 'user', content: 'привет' }] })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).kind).toBe('bad_response');
    expect((error as LlmError).message).toBe('Шлюз моделей вернул ответ неожиданного вида');
  });

  it('без ключа ошибка auth, запрос не отправляется', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => responsesOk([]));
    const client = createLlmClient({
      baseUrl,
      getApiKey: async () => undefined,
      api: 'responses',
      fetch: fetchMock
    });

    const error = await client
      .chat({ model: 'm', messages: [{ role: 'user', content: 'привет' }] })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).kind).toBe('auth');
    expect((error as LlmError).message).toBe('Не задан ключ шлюза моделей');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
