import { describe, expect, it, vi } from 'vitest';
import { checkGateway } from '../src/core/llm/check';

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

describe('checkGateway в формате responses', () => {
  it('пробный запрос уходит на /responses в формате Responses', async () => {
    const probeBodies: unknown[] = [];
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = urlOf(input);
      if (url.endsWith('/models')) {
        return modelsResponse(['alpha']);
      }
      probeBodies.push(JSON.parse(String(init?.body)));
      return jsonResponse({
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'pong' }] }]
      });
    });

    const result = await checkGateway(
      { baseUrl, model: 'alpha', apiKey: API_KEY, api: 'responses' },
      { fetch: fetchMock }
    );

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    const probeUrls = fetchMock.mock.calls.map(([input]) => urlOf(input)).filter((url) => !url.endsWith('/models'));
    expect(probeUrls).toEqual([`${baseUrl}/responses`]);
    expect(probeBodies[0]).toMatchObject({
      model: 'alpha',
      store: false,
      stream: false,
      max_output_tokens: 1,
      input: [{ role: 'user', content: [{ type: 'input_text', text: 'ping' }] }]
    });
  });

  it('отказ /responses с 404 — модели с таким именем нет', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) =>
      urlOf(input).endsWith('/models') ? modelsResponse(['alpha']) : new Response('', { status: 404 })
    );

    const result = await checkGateway(
      { baseUrl, model: 'alpha', apiKey: API_KEY, api: 'responses' },
      { fetch: fetchMock }
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Модели «alpha» нет на шлюзе');
  });

  it('ошибка формата chat распознаётся по тексту ответа шлюза', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) =>
      urlOf(input).endsWith('/models')
        ? modelsResponse(['alpha'])
        : jsonResponse(
            { error: { message: "The model does not support /chat/completions endpoint. Use /responses instead." } },
            400
          )
    );

    const result = await checkGateway(
      { baseUrl, model: 'alpha', apiKey: API_KEY, api: 'chat' },
      { fetch: fetchMock }
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Шлюз не поддерживает формат chat. Выберите формат Responses');
  });

  it('обычная ошибка chat-пробы не превращается в сообщение про формат', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) =>
      urlOf(input).endsWith('/models')
        ? modelsResponse(['alpha'])
        : jsonResponse({ error: { message: 'internal trouble' } }, 500)
    );

    const result = await checkGateway(
      { baseUrl, model: 'alpha', apiKey: API_KEY, api: 'chat' },
      { fetch: fetchMock }
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('Шлюз ответил ошибкой 500');
  });

  it('неизвестный формат api читается как chat: проба уходит на /chat/completions', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) =>
      urlOf(input).endsWith('/models') ? modelsResponse([]) : chatResponse()
    );

    const result = await checkGateway(
      { baseUrl, model: 'alpha', apiKey: API_KEY, api: 'giga' as never },
      { fetch: fetchMock }
    );

    expect(result.ok).toBe(true);
    const probeUrl = fetchMock.mock.calls.map(([input]) => urlOf(input)).find((url) => !url.endsWith('/models'));
    expect(probeUrl).toBe(`${baseUrl}/chat/completions`);
  });
});
