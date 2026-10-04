import type { GatewayCheckRequest } from './check';

export const DEFAULT_TIMEOUT_MS = 20_000;
const TIMEOUT_ERROR = 'Шлюз не ответил за 20 секунд';
const UNAVAILABLE_ERROR = 'Шлюз недоступен по указанному адресу';
export const AUTH_ERROR = 'Ключ шлюза не принят';

export type ModelsResult =
  | { ok: true; models: string[]; present: boolean }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

function connectionError(error: unknown): string {
  return isAbort(error) ? TIMEOUT_ERROR : UNAVAILABLE_ERROR;
}

function parseModels(payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    return [];
  }
  const names: string[] = [];
  for (const item of payload.data) {
    if (isRecord(item) && typeof item.id === 'string' && item.id.trim() !== '') {
      names.push(item.id);
    }
  }
  return names;
}

export function modelMissing(model: string): string {
  return `Модели «${model}» нет на шлюзе`;
}

function modelUnavailable(model: string): string {
  return `Модель «${model}» недоступна для этого ключа`;
}

function mentionsModel(body: string, model: string): boolean {
  const lower = body.toLowerCase();
  if (model !== '' && lower.includes(model.toLowerCase())) {
    return true;
  }
  return lower.includes('model_not_found') || lower.includes('model not found') || lower.includes('unknown model');
}

async function safeText(response: Response, apiKey: string): Promise<string> {
  try {
    const text = await response.text();
    return apiKey === '' ? text : text.split(apiKey).join('***');
  } catch {
    return '';
  }
}

async function requestWithKey(
  doFetch: typeof fetch,
  url: string,
  init: RequestInit,
  apiKey: string,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    return await doFetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${apiKey}` },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

// present=true, если шлюз ответил на /models: ключ принят. present=false — списка нет.
export async function fetchModels(
  doFetch: typeof fetch,
  baseUrl: string,
  apiKey: string,
  timeoutMs: number
): Promise<ModelsResult> {
  let response: Response;
  try {
    response = await requestWithKey(doFetch, `${baseUrl}/models`, { method: 'GET' }, apiKey, timeoutMs);
  } catch (error) {
    return { ok: false, error: connectionError(error) };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, error: AUTH_ERROR };
  }
  if (response.ok) {
    try {
      return { ok: true, models: parseModels(await response.json()), present: true };
    } catch {
      return { ok: true, models: [], present: true };
    }
  }
  // Шлюз без списка моделей — не ошибка, имена просто неизвестны.
  return { ok: true, models: [], present: false };
}

export async function probeChat(
  doFetch: typeof fetch,
  baseUrl: string,
  req: GatewayCheckRequest,
  timeoutMs: number,
  modelsPresent: boolean
): Promise<string | undefined> {
  let response: Response;
  try {
    response = await requestWithKey(
      doFetch,
      `${baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: req.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1
        })
      },
      req.apiKey,
      timeoutMs
    );
  } catch (error) {
    return connectionError(error);
  }
  if (response.ok) {
    return undefined;
  }
  if (response.status === 401 || response.status === 403) {
    // Список был получен — ключ принят, значит недоступна именно модель.
    return modelsPresent ? modelUnavailable(req.model) : AUTH_ERROR;
  }
  const body = await safeText(response, req.apiKey);
  if (response.status === 404 || mentionsModel(body, req.model)) {
    return modelMissing(req.model);
  }
  return `Шлюз ответил ошибкой ${response.status}`;
}
