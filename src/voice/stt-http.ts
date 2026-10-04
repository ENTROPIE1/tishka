export type TranscribeResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

const REQUEST_TIMEOUT_MS = 30000;
const NON_ASCII = /[^\x00-\x7F]/;

export function resolveBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export function inferenceUrl(url: string): string {
  return `${resolveBaseUrl(url)}/inference`;
}

export function servicePort(url: string): number {
  try {
    const parsed = new URL(url);
    if (parsed.port !== '') {
      return Number(parsed.port);
    }
    return parsed.protocol === 'https:' ? 443 : 80;
  } catch {
    return 8178;
  }
}

export function hasForeignChars(path: string): boolean {
  return NON_ASCII.test(path);
}

// Служба распознавания возвращает пометки вроде [музыка] и (смех), их убираем.
export function cleanTranscript(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function probe(fetchFn: typeof fetch, url: string): Promise<boolean> {
  try {
    const response = await fetchFn(`${resolveBaseUrl(url)}/`, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}

export async function transcribeHttp(
  fetchFn: typeof fetch,
  url: string,
  wav: Uint8Array
): Promise<TranscribeResult> {
  const bytes = new Uint8Array(wav.length);
  bytes.set(wav);
  const form = new FormData();
  form.append('file', new Blob([bytes.buffer], { type: 'audio/wav' }), 'audio.wav');
  form.append('response_format', 'json');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchFn(inferenceUrl(url), {
      method: 'POST',
      body: form,
      signal: controller.signal
    });
    if (!response.ok) {
      return { ok: false, error: `Служба распознавания ответила с ошибкой ${response.status}` };
    }
    const data: unknown = await response.json();
    const raw = isRecord(data) && typeof data.text === 'string' ? data.text : '';
    const text = cleanTranscript(raw);
    if (text === '') {
      return { ok: false, error: 'Не расслышал' };
    }
    return { ok: true, text };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, error: 'Служба распознавания не ответила вовремя' };
    }
    return { ok: false, error: 'Не удалось обратиться к службе распознавания' };
  } finally {
    clearTimeout(timer);
  }
}
