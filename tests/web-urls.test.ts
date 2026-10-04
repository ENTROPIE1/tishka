import { describe, expect, it } from 'vitest';
import { checkUrl, INTERNAL_URL_ERROR, SCHEME_URL_ERROR } from '../src/core/web/urls';

describe('checkUrl', () => {
  it('разрешает обычную внешнюю страницу', () => {
    const result = checkUrl('https://ru.wikipedia.org/wiki/Ёж');
    expect(result.ok).toBe(true);
  });

  it.each([
    'http://localhost',
    'http://127.0.0.1/wiki',
    'http://192.168.0.1',
    'http://10.1.2.3/x',
    'http://172.16.5.5/',
    'http://169.254.10.10/',
    'http://[::1]/',
    'http://intranet/'
  ])('отклоняет внутренний адрес %s', (url) => {
    const result = checkUrl(url);
    expect(result).toEqual({ ok: false, error: INTERNAL_URL_ERROR });
  });

  it.each(['file:///c:/secret.txt', 'ftp://example.org', 'javascript:alert(1)'])(
    'отклоняет неподдерживаемую схему %s',
    (url) => {
      const result = checkUrl(url);
      expect(result).toEqual({ ok: false, error: SCHEME_URL_ERROR });
    }
  );

  it('адрес перенаправления на внутренний адрес тоже отклоняется', () => {
    expect(checkUrl('http://192.168.1.10/next')).toEqual({ ok: false, error: INTERNAL_URL_ERROR });
    expect(checkUrl('https://ru.wikipedia.org/wiki/Ёж').ok).toBe(true);
  });
});
