export const INTERNAL_URL_ERROR = 'Внутренние адреса я не читаю';
export const SCHEME_URL_ERROR = 'Разрешены только адреса http и https';

export type UrlCheck = { ok: true; url: URL } | { ok: false; error: string };

function ipv4Parts(host: string): number[] | undefined {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (match === null) {
    return undefined;
  }
  const parts = match.slice(1).map((value) => Number(value));
  return parts.some((value) => value > 255) ? undefined : parts;
}

function isInternalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host === '0.0.0.0') {
    return true;
  }
  if (!host.includes('.')) {
    return true;
  }
  const parts = ipv4Parts(host);
  if (parts === undefined) {
    return false;
  }
  const [first, second] = parts;
  if (first === 0 || first === 10 || first === 127) {
    return true;
  }
  if (first === 172 && second >= 16 && second <= 31) {
    return true;
  }
  if (first === 192 && second === 168) {
    return true;
  }
  return first === 169 && second === 254;
}

// Внутренние адреса запрещены и для исходной страницы, и для каждого
// перенаправления, поэтому проверка вынесена в общую чистую функцию.
export function checkUrl(value: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: SCHEME_URL_ERROR };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: SCHEME_URL_ERROR };
  }
  if (isInternalHost(url.hostname)) {
    return { ok: false, error: INTERNAL_URL_ERROR };
  }
  return { ok: true, url };
}
