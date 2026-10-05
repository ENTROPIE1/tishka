import { describe, expect, it } from 'vitest';
import { buildJql, jiraToText } from '../mcp-servers/jira/src/client';

describe('buildJql', () => {
  it('понимает me и без параметров даёт пустую строку', () => {
    expect(buildJql({ me: true, status: 'Open' })).toBe('assignee = currentUser() AND status = "Open"');
    expect(buildJql({})).toBe('');
  });

  it('экранирует кавычки в значениях', () => {
    expect(buildJql({ text: 'отчёт "итог"' })).toBe('text ~ "отчёт \\"итог\\""');
    expect(buildJql({ project: 'A"B' })).toBe('project = "A\\"B"');
  });
});

describe('jiraToText', () => {
  it('убирает заголовки, списки, ссылки и код', () => {
    expect(jiraToText('h2. Итог\n* пункт\nСмотри {{код}} и [ссылку|https://example.org/s]')).toBe(
      'Итог\nпункт\nСмотри код и ссылку (https://example.org/s)'
    );
  });

  it('убирает код, цитаты и схлопывает пустые строки', () => {
    expect(jiraToText('{code}строка{code}\n\n\nещё')).toBe('строка\n\nещё');
  });
});
