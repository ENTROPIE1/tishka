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

function setup(
  data: unknown,
  status = 200
): { client: ReturnType<typeof createJiraClient>; requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = [];
  const fetchMock = (async (url: unknown, init?: unknown) => {
    requests.push({ url: String(url), init: init as RequestInit | undefined });
    return jsonResponse(data, status);
  }) as unknown as typeof fetch;
  const client = createJiraClient({
    baseUrl: 'https://jira.example.org/',
    token: TOKEN,
    fetch: fetchMock
  });
  return { client, requests };
}

function issueResponse(): unknown {
  const comments = [];
  for (let index = 1; index <= 6; index += 1) {
    comments.push({
      author: { displayName: `Автор ${index}` },
      created: `2026-09-0${index}T10:00:00.000+0300`,
      body: `Комментарий ${index}`
    });
  }
  return {
    key: 'ABC-123',
    fields: {
      summary: 'Починить вход',
      status: { name: 'В работе' },
      issuetype: { name: 'Ошибка' },
      priority: { name: 'Высокий' },
      assignee: { displayName: 'Иван' },
      reporter: { displayName: 'Аня' },
      created: '2026-09-01T10:00:00.000+0300',
      updated: '2026-09-02T11:00:00.000+0300',
      description: 'h1. Проблема\n* шаг один\n* шаг два\nСмотри [инструкцию|https://example.org/i]',
      comment: { comments }
    }
  };
}

describe('createJiraClient', () => {
  it('getIssue разбирает поля, ссылку и последние пять комментариев', async () => {
    const { client, requests } = setup(issueResponse());

    const issue = await client.getIssue('ABC-123');

    expect(issue.key).toBe('ABC-123');
    expect(issue.summary).toBe('Починить вход');
    expect(issue.status).toBe('В работе');
    expect(issue.type).toBe('Ошибка');
    expect(issue.priority).toBe('Высокий');
    expect(issue.assignee).toBe('Иван');
    expect(issue.reporter).toBe('Аня');
    expect(issue.url).toBe('https://jira.example.org/browse/ABC-123');
    expect(issue.description).toBe(
      'Проблема\nшаг один\nшаг два\nСмотри инструкцию (https://example.org/i)'
    );
    expect(issue.descriptionTruncated).toBe(false);
    expect(issue.comments).toHaveLength(5);
    expect(issue.comments[0]).toEqual({
      author: 'Автор 2',
      created: '2026-09-02T10:00:00.000+0300',
      body: 'Комментарий 2'
    });
    expect(requests[0].url).toBe(
      'https://jira.example.org/rest/api/2/issue/ABC-123?fields=summary,status,issuetype,priority,assignee,reporter,created,updated,description,comment'
    );
    const headers = requests[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(headers.Accept).toBe('application/json');
  });

  it('getIssue без исполнителя даёт пустую строку', async () => {
    const raw = issueResponse() as { fields: Record<string, unknown> };
    delete raw.fields.assignee;
    delete raw.fields.priority;
    const { client } = setup(raw);

    const issue = await client.getIssue('ABC-123');

    expect(issue.assignee).toBe('');
    expect(issue.priority).toBe('');
  });

  it('getIssue обрезает длинное описание и помечает это', async () => {
    const raw = issueResponse() as { fields: Record<string, unknown> };
    raw.fields.description = 'а'.repeat(7_000);
    const { client } = setup(raw);

    const issue = await client.getIssue('ABC-123');

    expect(issue.description).toHaveLength(6_000);
    expect(issue.descriptionTruncated).toBe(true);
  });

  it('searchByJql шлёт POST на /rest/api/2/search и разбирает список', async () => {
    const { client, requests } = setup({
      issues: [
        {
          key: 'ABC-1',
          fields: {
            summary: 'Первая',
            status: { name: 'Открыта' },
            assignee: { displayName: 'Иван' },
            updated: '2026-09-02T10:00:00.000+0300'
          }
        }
      ]
    });

    const found = await client.searchByJql('project = "ABC"', 25);

    expect(found).toEqual([
      {
        key: 'ABC-1',
        summary: 'Первая',
        status: 'Открыта',
        assignee: 'Иван',
        updated: '2026-09-02T10:00:00.000+0300',
        url: 'https://jira.example.org/browse/ABC-1'
      }
    ]);
    expect(requests[0].url).toBe('https://jira.example.org/rest/api/2/search');
    expect(requests[0].init?.method).toBe('POST');
    const body = JSON.parse(String(requests[0].init?.body)) as {
      jql: string;
      maxResults: number;
      fields: string[];
    };
    expect(body.jql).toBe('project = "ABC"');
    expect(body.maxResults).toBe(25);
    expect(body.fields).toEqual(['summary', 'status', 'assignee', 'updated']);
  });

  it('search собирает JQL из параметров, экранирует кавычки и ограничивает предел', async () => {
    const { client, requests } = setup({ issues: [] });

    const found = await client.search({
      text: 'отчёт "итог"',
      project: 'ABC',
      assignee: 'Иван',
      status: 'В работе',
      updatedSince: '2026-09-01',
      limit: 100
    });

    expect(found).toEqual([]);
    const body = JSON.parse(String(requests[0].init?.body)) as { jql: string; maxResults: number };
    expect(body.jql).toBe(
      'text ~ "отчёт \\"итог\\"" AND project = "ABC" AND assignee = "Иван" AND status = "В работе" AND updated >= "2026-09-01"'
    );
    expect(body.maxResults).toBe(25);
  });

  it('myIssues ищет открытые задачи текущего пользователя', async () => {
    const { client, requests } = setup({ issues: [] });

    await client.myIssues();

    const body = JSON.parse(String(requests[0].init?.body)) as { jql: string; maxResults: number };
    expect(body.jql).toBe('assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC');
    expect(body.maxResults).toBe(10);
  });
});
