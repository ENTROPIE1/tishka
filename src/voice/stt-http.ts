import type { TimingMark } from '../main/timing-log';

export type TranscribeResult =
  | { ok: true; text: string }
  | { ok: false; error: string; empty?: boolean };

const REQUEST_TIMEOUT_MS = 30000;
export const PROBE_TIMEOUT_MS = 3000;
const NON_ASCII = /[^\x00-\x7F]/;
const MEANINGFUL = /[\p{L}\p{N}]/u;

// Вероятность отсутствия речи в сегменте выше этого порога — фраза шумная.
const NO_SPEECH_MAX = 0.6;
// Средняя уверенность сегментов (exp(avg_logprob)) ниже этого порога — результат ненадёжен.
const MIN_CONFIDENCE = 0.35;

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

// Пустой результат, одни пометки, шум или знаки препинания — не речь человека.
export function isNoiseTranscript(text: string): boolean {
  return !MEANINGFUL.test(text);
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

export interface SttCheckView {
  ok: boolean;
  ms: number;
  error?: string;
}

// Проверка адреса для кнопки «Проверить»: сколько миллисекунд отвечала служба
// или почему ответа нет. Чужой процесс не трогаем — только запрос.
export async function checkSttUrl(
  fetchFn: typeof fetch,
  url: string,
  timeoutMs: number = PROBE_TIMEOUT_MS
): Promise<SttCheckView> {
  const startedAt = Date.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = fetchFn(`${resolveBaseUrl(url)}/`, {
      method: 'GET',
      signal: controller.signal
    }).then(
      (response) => ({ kind: 'responded' as const, response }),
      (error: unknown) => ({ kind: 'failed' as const, error })
    );
    const expired = new Promise<{ kind: 'timeout' }>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ kind: 'timeout' });
      }, timeoutMs);
    });
    const outcome = await Promise.race([request, expired]);
    const ms = Date.now() - startedAt;
    if (outcome.kind === 'timeout') {
      return { ok: false, ms, error: 'Служба не ответила вовремя' };
    }
    if (outcome.kind === 'failed') {
      return { ok: false, ms, error: 'Служба не отвечает по адресу' };
    }
    if (!outcome.response.ok) {
      return { ok: false, ms, error: `Служба ответила с ошибкой ${outcome.response.status}` };
    }
    return { ok: true, ms };
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

// Подробный ответ службы (verbose_json) несёт сегменты с вероятностью отсутствия
// речи и средней логарифмической вероятностью. Если этих полей нет, доверяем
// результату как раньше: отсеивать нечего.
export function isUnreliable(data: Record<string, unknown>): boolean {
  const segments = Array.isArray(data.segments) ? data.segments : [];
  const noSpeech: number[] = [];
  const logProbs: number[] = [];
  for (const segment of segments) {
    if (!isRecord(segment)) {
      continue;
    }
    const probability = readNumber(segment.no_speech_prob);
    if (probability !== undefined) {
      noSpeech.push(probability);
    }
    const logProb = readNumber(segment.avg_logprob);
    if (logProb !== undefined) {
      logProbs.push(logProb);
    }
  }
  if (noSpeech.length === 0 && logProbs.length === 0) {
    return false;
  }
  const maxNoSpeech = noSpeech.length > 0 ? Math.max(...noSpeech) : 0;
  const confidence =
    logProbs.length > 0 ? Math.exp(logProbs.reduce((sum, value) => sum + value, 0) / logProbs.length) : 1;
  return maxNoSpeech >= NO_SPEECH_MAX || confidence < MIN_CONFIDENCE;
}

type SendOutcome =
  | { kind: 'ok'; data: unknown }
  | { kind: 'unsupported' }
  | { kind: 'error'; status: number };

function buildForm(bytes: Uint8Array, prompt: string | undefined, verbose: boolean): FormData {
  const form = new FormData();
  form.append('file', new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/wav' }), 'audio.wav');
  form.append('response_format', verbose ? 'verbose_json' : 'json');
  if (prompt !== undefined && prompt !== '') {
    form.append('prompt', prompt);
  }
  return form;
}

async function send(
  fetchFn: typeof fetch,
  url: string,
  bytes: Uint8Array,
  prompt: string | undefined,
  verbose: boolean,
  signal: AbortSignal
): Promise<SendOutcome> {
  const response = await fetchFn(inferenceUrl(url), {
    method: 'POST',
    body: buildForm(bytes, prompt, verbose),
    signal
  });
  if (response.ok) {
    return { kind: 'ok', data: await response.json() };
  }
  // Служба может не поддерживать подробный ответ — повторим с обычным форматом.
  return verbose ? { kind: 'unsupported' } : { kind: 'error', status: response.status };
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
  const startedAt = Date.now();
  const size = wav.length;
  mark?.('stt.request.start', { bytes: size });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let outcome = await send(fetchFn, url, bytes, prompt, true, controller.signal);
    if (outcome.kind === 'unsupported') {
      outcome = await send(fetchFn, url, bytes, prompt, false, controller.signal);
    }
    if (outcome.kind !== 'ok') {
      if (outcome.kind === 'error') {
        mark?.('stt.request.end', { ok: false, code: outcome.status, bytes: size, ms: Date.now() - startedAt });
        return { ok: false, error: `Служба распознавания ответила с ошибкой ${outcome.status}` };
      }
      mark?.('stt.request.end', { ok: false, bytes: size, ms: Date.now() - startedAt });
      return { ok: false, error: 'Не удалось обратиться к службе распознавания' };
    }
    const data = outcome.data;
    const raw = isRecord(data) && typeof data.text === 'string' ? data.text : '';
    const text = cleanTranscript(raw);
    // Пустой текст, одни пометки или ненадёжные подробности — не речь человека:
    // возвращаем пустой результат, человеку он не показывается.
    if (text === '' || isNoiseTranscript(text) || (isRecord(data) && isUnreliable(data))) {
      mark?.('stt.request.end', { ok: false, bytes: size, chars: 0, ms: Date.now() - startedAt });
      return { ok: false, error: 'Не расслышал', empty: true };
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
