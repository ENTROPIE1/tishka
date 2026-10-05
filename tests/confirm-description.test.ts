import { describe, expect, it } from 'vitest';
import { confirmQuestion, describeAction, scrubSecrets } from '../src/core/tools/confirm-description';

describe('confirm-description', () => {
  it('описание содержит инструмент и аргументы', () => {
    const action = describeAction('jira__create', { project: 'ABC', summary: 'Задача' });
    expect(action).toContain('jira__create');
    expect(action).toContain('ABC');
  });

  it('секреты не попадают в описание', () => {
    const action = describeAction('mail__send', {
      to: 'a@b.c',
      token: 'super-secret',
      headers: { Authorization: 'Bearer nope' }
    });
    expect(action).not.toContain('super-secret');
    expect(action).not.toContain('nope');
    expect(action).toContain('***');
  });

  it('описание не длиннее 300 знаков', () => {
    const action = describeAction('tool', { long: 'x'.repeat(1000) });
    expect(action.length).toBe(300);
    expect(action.endsWith('…')).toBe(true);
  });

  it('scrubSecrets рекурсивно чистит вложенные поля', () => {
    expect(scrubSecrets({ a: 1, data: { password: 'p', keep: 'ok' } })).toEqual({
      a: 1,
      data: { password: '***', keep: 'ok' }
    });
  });

  it('готовая строка вопроса называет действие и подключение', () => {
    expect(confirmQuestion('создать задачу', 'jira')).toBe('Выполнить создать задачу через jira?');
  });
});
