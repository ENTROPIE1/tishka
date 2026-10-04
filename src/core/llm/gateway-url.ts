export type NormalizeBaseUrlResult = { ok: true; value: string } | { ok: false; error: string };

// Пробелы по краям и завершающие косые уезжают, хвост /chat/completions тоже.
export function normalizeBaseUrl(raw: string): NormalizeBaseUrlResult {
  let value = raw.trim();
  if (value === '') {
    return { ok: false, error: 'Адрес шлюза не задан' };
  }
  if (!/^https?:\/\//i.test(value)) {
    return { ok: false, error: 'Адрес должен начинаться с http:// или https://' };
  }
  value = value.replace(/\/+$/, '');
  value = value.replace(/\/chat\/completions\/?$/i, '');
  value = value.replace(/\/+$/, '');
  return { ok: true, value };
}
