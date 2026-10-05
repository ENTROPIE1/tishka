import { describe, expect, it } from 'vitest';
import { connectionSignature } from '../src/core/connection-signature';

const prepared = {
  name: 'confluence',
  transport: 'http' as const,
  url: 'https://wiki.example.org',
  headers: { Authorization: 'Bearer ${secret:CONFLUENCE_TOKEN}' }
};

describe('connectionSignature', () => {
  it('это хеш SHA-256, одинаковые настройки дают одинаковую подпись', () => {
    const first = connectionSignature(prepared, { Authorization: 'Bearer abc' });
    const second = connectionSignature(prepared, { Authorization: 'Bearer abc' });
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toBe(second);
  });

  it('смена секрета меняет подпись, но его текст в подписи не сохраняется', () => {
    const secret = 'super-secret-token-value';
    const withSecret = connectionSignature(prepared, { Authorization: `Bearer ${secret}` });
    const changed = connectionSignature(prepared, { Authorization: 'Bearer other' });

    expect(withSecret).not.toBe(changed);
    expect(withSecret).not.toContain(secret);
  });
});
