import type { TimingMark } from '../main/timing-log';

export type TranscribeResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

const REQUEST_TIMEOUT_MS = 30000;
export const PROBE_TIMEOUT_MS = 3000;
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

// Проверка доступности службы с коротким пределом времени: зависший запрос
// не задерживает общий срок готовности.
export async function probe(
  fetchFn: typeof fetch,
  url: string,
  timeoutMs: number = PROBE_TIMEOUT_MS
): Promise<boolean> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = fetchFn(`${resolveBaseUrl(url)}/`, {
      method: 'GET',
      signal: controller.signal
    }).then(
      (response) => response.ok,
      () => false
    );
    const expired = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(false);
      }, timeoutMs);
    });
    return await Promise.race([request, expired]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export async function transcribeHttp(
  fetchFn: typeof fetch,
  url: string,
  wav: Uint8Array,
  prompt?: string,
  mark?: TimingMark
): Promise<TranscribeResult> {
  const bytes = new Uint8Array(wav.length);
  bytes.set(wav);
  const form = new FormData();
  form.append('file', new Blob([bytes.buffer], { type: 'audio/wav' }), 'audio.wav');
  form.append('response_format', 'json');
  if (prompt !== undefined && prompt !== '') {
    form.append('prompt', prompt);
  }

  const startedAt = Date.now();
  const size = wav.length;
  mark?.('stt.request.start', { bytes: size });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchFn(inferenceUrl(url), {
      method: 'POST',
      body: form,
      signal: controller.signal
    });
    if (!response.ok) {
      mark?.('stt.request.end', { ok: false, code: response.status, bytes: size, ms: Date.now() - startedAt });
      return { ok: false, error: `Служба распознавания ответила с ошибкой ${response.status}` };
    }
    const data: unknown = await response.json();
    const raw = isRecord(data) && typeof data.text === 'string' ? data.text : '';
    const text = cleanTranscript(raw);
    if (text === '') {
      mark?.('stt.request.end', { ok: false, bytes: size, chars: 0, ms: Date.now() - startedAt });
      return { ok: false, error: 'Не расслышал' };
    }
    mark?.('stt.request.end', { ok: true, bytes: size, chars: text.length, ms: Date.now() - startedAt });
    return { ok: true, text };
  } catch (error) {
    const reason = error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network';
    mark?.('stt.request.end', { ok: false, reason, bytes: size, ms: Date.now() - startedAt });
    if (reason === 'timeout') {
      return { ok: false, error: 'Служба распознавания не ответила вовремя' };
    }
    return { ok: false, error: 'Не удалось обратиться к службе распознавания' };
  } finally {
    clearTimeout(timer);
  }
}
