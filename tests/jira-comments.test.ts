import { describe, expect, it } from 'vitest';
import { createJiraClient, type JiraComment } from '../mcp-servers/jira/src/client';

function jsonResponse(data: unknown): unknown {
  return { ok: true, status: 200, json: async () => data };
}

function setup(data: unknown): { client: ReturnType<typeof createJiraClient>; urls: string[] } {
  const urls: string[] = [];
  const fetchMock = (async (url: unknown) => {
    urls.push(String(url));
    return jsonResponse(data);
  }) as unknown as typeof fetch;
  const client = createJiraClient({
    baseUrl: 'https://jira.example.org',
    token: 'secret-token',
    fetch: fetchMock
  });
  return { client, urls };
}

describe('комментарии Jira', () => {
  it('getIssue обрезает комментарий до 300 знаков', async () => {
    const { client } = setup({
      key: 'ABC-123',
      fields: {
        comment: {
          comments: [
            { author: { displayName: 'Олег' }, created: '2026-09-01T10:00:00.000+0300', body: 'б'.repeat(400) }
          ]
        }
      }
    });

    const issue = await client.getIssue('ABC-123');

    expect(issue.comments[0].body).toHaveLength(301);
    expect(issue.comments[0].body.endsWith('…')).toBe(true);
  });

  it('getComments сортирует от старых к новым и передаёт предел', async () => {
    const { client, urls } = setup({
      comments: [
        { author: { displayName: 'Новый' }, created: '2026-09-03T10:00:00.000+0300', body: 'второй' },
        { author: { displayName: 'Старый' }, created: '2026-09-01T10:00:00.000+0300', body: 'первый' }
      ]
    });

    const comments = await client.getComments('ABC-123', 5);

    expect(comments.map((comment: JiraComment) => comment.body)).toEqual(['первый', 'второй']);
    expect(urls[0]).toBe(
      'https://jira.example.org/rest/api/2/issue/ABC-123/comment?maxResults=5'
    );
  });
});
