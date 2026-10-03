import { describe, expect, it } from 'vitest';
import { createConfluenceClient } from '../mcp-servers/confluence/src/client';

const TOKEN = 'secret-token-123';

interface CapturedRequest {
  url: string;
  init?: RequestInit;
}

function jsonResponse(data: unknown, status = 200): unknown {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

function setup(data: unknown, status = 200): { client: ReturnType<typeof createConfluenceClient>; requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = [];
  const fetchMock = (async (url: unknown, init?: unknown) => {
    requests.push({ url: String(url), init: init as RequestInit | undefined });
    return jsonResponse(data, status);
  }) as unknown as typeof fetch;
  const client = createConfluenceClient({
    baseUrl: 'https://wiki.example.org/',
    token: TOKEN,
    fetch: fetchMock
  });
  return { client, requests };
}

function setupBrokenFetch(): ReturnType<typeof createConfluenceClient> {
  const fetchMock = (async () => {
    throw new Error('ECONNREFUSED');
  }) as unknown as typeof fetch;
  return createConfluenceClient({ baseUrl: 'https://wiki.example.org', token: TOKEN, fetch: fetchMock });
}

describe('createConfluenceClient', () => {
  it('getPageVersion разбирает номер, дату, автора и собирает ссылку', async () => {
    const { client, requests } = setup({
      id: '123',
      title: 'Инструкция',
      version: { number: 7, when: '2026-09-01T10:00:00Z', by: { displayName: 'Иван' } },
      _links: { base: 'https://wiki.example.org', webui: '/pages/123' }
    });

    const version = await client.getPageVersion('123');

    expect(version).toEqual({
      id: '123',
      title: 'Инструкция',
      url: 'https://wiki.example.org/pages/123',
      version: 7,
      updated: '2026-09-01T10:00:00Z',
      updatedBy: 'Иван'
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://wiki.example.org/rest/api/content/123?expand=version');
    const headers = requests[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers.Accept).toBe('application/json');
  });

  it('getPage убирает теги и сущности, схлопывает пустые строки', async () => {
    const { client } = setup({
      id: '123',
      title: 'Инструкция',
      version: { number: 7, when: '2026-09-01T10:00:00Z', by: { displayName: 'Иван' } },
      _links: { base: 'https://wiki.example.org', webui: '/pages/123' },
      body: {
        view: { value: '<h1>Заголовок</h1><p>Первый&nbsp;абзац &amp; «детали»</p><p></p><p>Второй</p>' }
      }
    });

    const page = await client.getPage('123');

    expect(page.text).toBe('Заголовок\nПервый абзац & «детали»\n\nВторой');
    expect(page.truncated).toBe(false);
  });

  it('getPage обрезает длинное тело и помечает truncated', async () => {
    const { client } = setup({
      id: '123',
      title: 'Инструкция',
      version: { number: 7, when: '2026-09-01T10:00:00Z', by: { displayName: 'Иван' } },
      _links: { base: '', webui: '' },
      body: { view: { value: 'а'.repeat(21_000) } }
    });

    const page = await client.getPage('123');

    expect(page.text).toHaveLength(20_000);
    expect(page.truncated).toBe(true);
  });

  it('getPageHistory возвращает версии по порядку из ответа', async () => {
    const { client, requests } = setup({
      results: [
        { number: 3, when: '2026-09-03T10:00:00Z', by: { displayName: 'Аня' }, message: 'правки' },
        { number: 2, when: '2026-09-02T10:00:00Z', by: { displayName: 'Олег' }, message: '' }
      ]
    });

    const history = await client.getPageHistory('123', 2);

    expect(history).toEqual([
      { version: 3, when: '2026-09-03T10:00:00Z', by: 'Аня', message: 'правки' },
      { version: 2, when: '2026-09-02T10:00:00Z', by: 'Олег', message: '' }
    ]);
    expect(requests[0].url).toBe(
      'https://wiki.example.org/rest/experimental/content/123/version?limit=2'
    );
  });

  it('getPageHistory без limit передаёт 10, а большой limit обрезает до 50', async () => {
    const { client, requests } = setup({ results: [] });

    await client.getPageHistory('123');
    await client.searchPages('запрос', 500);

    expect(new URL(requests[0].url).searchParams.get('limit')).toBe('10');
    expect(new URL(requests[1].url).searchParams.get('limit')).toBe('50');
  });

  it('searchPages экранирует кавычки в CQL и передаёт limit', async () => {
    const { client, requests } = setup({
      results: [{ id: '5', title: 'Найдено', _links: { base: 'https://wiki.example.org', webui: '/pages/5' } }]
    });

    const found = await client.searchPages('отчёт "итог"', 25);

    expect(found).toEqual([{ id: '5', title: 'Найдено', url: 'https://wiki.example.org/pages/5' }]);
    const url = new URL(requests[0].url);
    expect(url.pathname).toBe('/rest/api/content/search');
    expect(url.searchParams.get('cql')).toBe('type=page AND text ~ "отчёт \\"итог\\""');
    expect(url.searchParams.get('limit')).toBe('25');
  });

  it('401 превращается в ошибку про токен, текст не содержит токен', async () => {
    const { client } = setup({}, 401);

    const error = await client.getPageVersion('123').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Confluence отклонил токен');
    expect((error as Error).message).not.toContain(TOKEN);
  });

  it('404 превращается в ошибку про отсутствие страницы', async () => {
    const { client } = setup({}, 404);

    await expect(client.getPageVersion('123')).rejects.toThrow('Страница не найдена');
  });

  it('сбой сети превращается в ошибку про VPN, текст не содержит токен', async () => {
    const client = setupBrokenFetch();

    const error = await client.getPageVersion('123').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Confluence недоступен, проверьте VPN');
    expect((error as Error).message).not.toContain(TOKEN);
  });

  it('pageId не из цифр даёт ошибку без обращения к сети', async () => {
    const { client, requests } = setup({});

    await expect(client.getPageVersion('12ab')).rejects.toThrow('должен состоять из цифр');
    await expect(client.getPageHistory('abc')).rejects.toThrow('должен состоять из цифр');
    expect(requests).toHaveLength(0);
  });
});
