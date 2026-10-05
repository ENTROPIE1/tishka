import { buildJql } from './jql';
import { toComment, toIssue, toRef, type RawCommentList, type RawIssue, type RawSearch } from './mappers';
import type { JiraClient, JiraComment, JiraIssue, JiraIssueRef, JiraSearchParams } from './types';

export type { JiraClient, JiraComment, JiraIssue, JiraIssueRef, JiraSearchParams } from './types';
export { buildJql } from './jql';
export { jiraToText } from './markup';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const COMMENTS_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 20_000;
const ISSUE_FIELDS =
  'summary,status,issuetype,priority,assignee,reporter,created,updated,description,comment';
const REF_FIELDS = 'summary,status,assignee,updated';

export function createJiraClient(opts: {
  baseUrl: string;
  token?: string;
  user?: string;
  password?: string;
  fetch?: typeof fetch;
}): JiraClient {
  const baseUrl = opts.baseUrl.replace(/\/+$/, '');
  const doFetch = opts.fetch ?? fetch;
  const authorization = buildAuthorization(opts);

  async function request(path: string, init?: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        ...init,
        headers: { Authorization: authorization, Accept: 'application/json', ...(init?.headers ?? {}) },
        signal: controller.signal
      });
    } catch (error) {
      // сюда попадает и срабатывание таймаута: abort проявляется как отказ сети
      throw new Error('Jira недоступна, проверьте VPN', { cause: error });
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error('Jira отклонила учётные данные');
    }
    if (response.status === 404) {
      throw new Error('Задача не найдена');
    }
    if (!response.ok) {
      throw new Error(`Jira вернула статус ${response.status}`);
    }
    try {
      return await response.json();
    } catch (error) {
      throw new Error('Jira вернула некорректный ответ', { cause: error });
    }
  }

  async function getIssue(key: string): Promise<JiraIssue> {
    const id = requireKey(key);
    const raw = (await request(
      `/rest/api/2/issue/${encodeURIComponent(id)}?fields=${ISSUE_FIELDS}`
    )) as RawIssue;
    return toIssue(raw, baseUrl);
  }

  async function getComments(key: string, limit?: number): Promise<JiraComment[]> {
    const id = requireKey(key);
    const raw = (await request(
      `/rest/api/2/issue/${encodeURIComponent(id)}/comment?maxResults=${commentsLimit(limit)}`
    )) as RawCommentList;
    const comments = Array.isArray(raw.comments) ? raw.comments : [];
    return [...comments].sort((a, b) => String(a.created).localeCompare(String(b.created))).map(toComment);
  }

  async function searchByJql(jql: string, limit?: number): Promise<JiraIssueRef[]> {
    const body = { jql, maxResults: normalizeLimit(limit), fields: REF_FIELDS.split(',') };
    const raw = (await request('/rest/api/2/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })) as RawSearch;
    const issues = Array.isArray(raw.issues) ? raw.issues : [];
    return issues.map((issue) => toRef(issue, baseUrl));
  }

  async function search(params: JiraSearchParams): Promise<JiraIssueRef[]> {
    return searchByJql(buildJql(params), params.limit);
  }

  async function myIssues(limit?: number): Promise<JiraIssueRef[]> {
    return searchByJql(
      'assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC',
      limit
    );
  }

  return { getIssue, getComments, search, searchByJql, myIssues };
}

function buildAuthorization(opts: { token?: string; user?: string; password?: string }): string {
  if (opts.token !== undefined && opts.token !== '') {
    return `Bearer ${opts.token}`;
  }
  if (opts.user !== undefined && opts.user !== '' && opts.password !== undefined) {
    return `Basic ${Buffer.from(`${opts.user}:${opts.password}`).toString('base64')}`;
  }
  throw new Error('Jira MCP-сервер: не заданы токен или логин с паролем');
}

function requireKey(key: string): string {
  const value = key.trim();
  if (!/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(value)) {
    throw new Error('Ключ задачи должен быть вида ABC-123');
  }
  return value;
}

function normalizeLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.max(1, Math.trunc(limit)), MAX_LIMIT);
}

function commentsLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return COMMENTS_LIMIT;
  }
  return Math.min(Math.max(1, Math.trunc(limit)), COMMENTS_LIMIT);
}
