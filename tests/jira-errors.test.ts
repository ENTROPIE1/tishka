import { describe, expect, it } from 'vitest';
import { createJiraClient } from '../mcp-servers/jira/src/client';

const TOKEN = 'secret-token-123';

interface CapturedRequest {
  url: string;
  init?: RequestInit;
}

function jsonResponse(data: unknown, status = 200): unknown {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

function setup(data: unknown, status = 200): { client: ReturnType<typeof createJiraClient> } {
  const fetchMock = (async () => jsonResponse(data, status)) as unknown as typeof fetch;
  const client = createJiraClient({
    baseUrl: 'https://jira.example.org',
    token: TOKEN,
    fetch: fetchMock
  });
  return { client };
}

describe('ошибки и вход Jira', () => {
  it('401 превращается в ошибку без токена в тексте', async () => {
    const { client } = setup({}, 401);

    const error = await client.getIssue('ABC-123').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Jira отклонила учётные данные');
    expect((error as Error).message).not.toContain(TOKEN);
  });

  it('404 по несуществующему ключу даёт понятную ошибку', async () => {
    const { client } = setup({}, 404);

    await expect(client.getIssue('ABC-999')).rejects.toThrow('Задача не найдена');
  });

  it('сбой сети превращается в ошибку про VPN', async () => {
    const fetchMock = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const client = createJiraClient({ baseUrl: 'https://jira.example.org', token: TOKEN, fetch: fetchMock });

    await expect(client.getIssue('ABC-123')).rejects.toThrow('Jira недоступна, проверьте VPN');
  });

  it('без токена вход идёт по логину и паролю', async () => {
    const requests: CapturedRequest[] = [];
    const fetchMock = (async (url: unknown, init?: unknown) => {
      requests.push({ url: String(url), init: init as RequestInit | undefined });
      return jsonResponse({});
    }) as unknown as typeof fetch;
    const client = createJiraClient({
      baseUrl: 'https://jira.example.org',
      user: 'DOM\\user',
      password: 'pass',
      fetch: fetchMock
    });

    await client.getIssue('ABC-123');

    const headers = requests[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from('DOM\\user:pass').toString('base64')}`);
  });

  it('без токена и логина клиент не создаётся', () => {
    expect(() => createJiraClient({ baseUrl: 'https://jira.example.org' })).toThrow(
      'не заданы токен или логин с паролем'
    );
  });

  it('ключ не из формата задачи даёт ошибку без обращения к сети', async () => {
    let calls = 0;
    const fetchMock = (async () => {
      calls += 1;
      return jsonResponse({});
    }) as unknown as typeof fetch;
    const client = createJiraClient({ baseUrl: 'https://jira.example.org', token: TOKEN, fetch: fetchMock });

    await expect(client.getIssue('123')).rejects.toThrow('Ключ задачи должен быть вида ABC-123');
    await expect(client.getComments('abc')).rejects.toThrow('Ключ задачи должен быть вида ABC-123');
    expect(calls).toBe(0);
  });
});
