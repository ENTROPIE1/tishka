import type { ChatRequest, ChatResponse, LlmApi } from './protocol';
import { LlmError } from './protocol';
import { CancelledError } from '../cancel';
import { chatWireBody, parseResponse } from './chat-format';
import { parseResponsesResponse, responseFromEventStream, toResponsesRequest } from './responses-format';
import type { TimingMark } from '../../main/timing-log';

export type { ChatMessage, ChatRequest, ChatResponse, ContentPart, ToolCall } from './protocol';
export type { LlmApi, LlmErrorKind } from './protocol';
export { LlmError } from './protocol';

// Переход на запасную модель случился: имя основной, запасной и причина (вид отказа).
export interface FallbackInfo {
  from: string;
  to: string;
  reason: string;
}

export interface LlmClientOptions {
  baseUrl: string | (() => string);
  getApiKey: () => Promise<string | undefined>;
  api?: LlmApi | (() => LlmApi);   // формат запросов; нет или неизвестно — 'chat'
  fetch?: typeof fetch;
  fallbackModel?: (model: string) => string | undefined;   // запасная модель для запрошенной
  onFallback?: (info: FallbackInfo) => void;               // один раз за период перехода
  fallbackWindowMs?: number;                               // сколько держаться запасной, по умолчанию 5 минут
  now?: () => number;                                      // текущее время, подменяется в тестах
  mark?: TimingMark;                                       // журнал времени
}

const TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [1000, 3000, 7000];
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const EVENT_STREAM_TYPE = 'text/event-stream';
const DEFAULT_FALLBACK_WINDOW_MS = 5 * 60_000;
const BUDGET_MARKER = 'exceeded budget';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function retryDelay(attempt: number): number {
  return RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
}

function parseRetryAfter(header: string | null): number | null {
  if (header === null) {
    return null;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(header);
  if (Number.isNaN(date)) {
    return null;
  }
  return Math.max(0, date - Date.now());
}

async function readBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

// Тело ошибки шлюза читается только для распознавания лимита; в текст ошибки
// оно не попадает — ни идентификатор ключа, ни почта в ленту не уходят.
async function responseError(response: Response, model: string): Promise<LlmError> {
  const status = response.status;
  const body = await readBody(response);
  if (body.toLowerCase().includes(BUDGET_MARKER)) {
    return new LlmError('limit', 'На модели исчерпан дневной лимит', true, model);
  }
  if (status === 401 || status === 403) {
    return new LlmError('auth', 'Ключ шлюза моделей отклонён', false, model);
  }
  if (status === 429) {
    return new LlmError('limit', 'Шлюз моделей просит снизить частоту запросов', false, model);
  }
  if (status >= 500) {
    return new LlmError('server', `Шлюз моделей недоступен, код ответа ${status}`, false, model);
  }
  return new LlmError('bad_response', `Шлюз моделей отклонил запрос, код ответа ${status}`, false, model);
}

function isTransition(error: unknown): boolean {
  return error instanceof LlmError && (error.kind === 'server' || error.kind === 'network');
}

export function createLlmClient(opts: LlmClientOptions): {
  chat(req: ChatRequest): Promise<ChatResponse>;
} {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? ((): number => Date.now());
  const fallbackWindowMs = opts.fallbackWindowMs ?? DEFAULT_FALLBACK_WINDOW_MS;
  const fallbackUntil = new Map<string, number>();
  const resolveBaseUrl = (): string => {
    const raw = typeof opts.baseUrl === 'function' ? opts.baseUrl() : opts.baseUrl;
    return raw.replace(/\/+$/, '');
  };
  const resolveApi = (): LlmApi => {
    const raw = typeof opts.api === 'function' ? opts.api() : opts.api;
    return raw === 'responses' ? 'responses' : 'chat';
  };
  const resolveFallback = (model: string): string | undefined => {
    const candidate = opts.fallbackModel?.(model)?.trim();
    if (candidate === undefined || candidate === '' || candidate === model) {
      return undefined;
    }
    return candidate;
  };

  function wireRequest(
    req: ChatRequest,
    api: LlmApi,
    base: string,
    model: string
  ): { url: string; body: string } {
    const request: ChatRequest = { ...req, model };
    if (api === 'responses') {
      return { url: `${base}/responses`, body: JSON.stringify(toResponsesRequest(request)) };
    }
    return { url: `${base}/chat/completions`, body: JSON.stringify(chatWireBody(request)) };
  }

  async function requestOnce(
    req: ChatRequest,
    apiKey: string,
    api: LlmApi,
    model: string
  ): Promise<Response> {
    const controller = new AbortController();
    const external = req.signal;
    const onAbort = (): void => {
      controller.abort();
    };
    if (external !== undefined) {
      if (external.aborted) {
        controller.abort();
      } else {
        external.addEventListener('abort', onAbort, { once: true });
      }
    }
    const timer = setTimeout(() => {
      controller.abort();
    }, TIMEOUT_MS);
    const wire = wireRequest(req, api, resolveBaseUrl(), model);
    try {
      return await doFetch(wire.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: wire.body,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
      external?.removeEventListener('abort', onAbort);
    }
  }

  async function readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new LlmError('bad_response', 'Шлюз моделей вернул ответ неожиданного вида');
    }
  }

  async function readOk(response: Response, api: LlmApi): Promise<ChatResponse> {
    if (api !== 'responses') {
      return parseResponse(await readJson(response));
    }
    const contentType = response.headers.get('Content-Type') ?? '';
    if (contentType.includes(EVENT_STREAM_TYPE)) {
      return parseResponsesResponse(responseFromEventStream(await response.text()));
    }
    return parseResponsesResponse(await readJson(response));
  }

  // Запрос к одной модели с обычными повторами. attempts=1 — одна попытка без повторов.
  async function perform(
    req: ChatRequest,
    apiKey: string,
    model: string,
    attempts: number
  ): Promise<ChatResponse> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (req.signal?.aborted) {
        throw new CancelledError();
      }
      const api = resolveApi();
      let response: Response;
      try {
        response = await requestOnce(req, apiKey, api, model);
      } catch {
        // Отмена человеком — не сетевой сбой: без повторных попыток.
        if (req.signal?.aborted) {
          throw new CancelledError();
        }
        if (attempt < attempts - 1) {
          await delay(retryDelay(attempt));
          continue;
        }
        throw new LlmError('network', 'Не удалось связаться со шлюзом моделей', false, model);
      }

      if (response.ok) {
        if (req.signal?.aborted) {
          throw new CancelledError();
        }
        return readOk(response, api);
      }

      const error = await responseError(response, model);
      const retryable = RETRYABLE_STATUSES.has(response.status) && !error.budget;
      if (retryable && attempt < attempts - 1) {
        const retryAfter = parseRetryAfter(response.headers.get('Retry-After'));
        await delay(retryAfter ?? retryDelay(attempt));
        continue;
      }
      throw error;
    }

    throw new LlmError('server', 'Шлюз моделей недоступен', false, model);
  }

  async function chat(req: ChatRequest): Promise<ChatResponse> {
    const apiKey = await opts.getApiKey();
    if (apiKey === undefined || apiKey.length === 0) {
      throw new LlmError('auth', 'Не задан ключ шлюза моделей');
    }

    const fallback = resolveFallback(req.model);
    if (fallback === undefined) {
      return perform(req, apiKey, req.model, MAX_ATTEMPTS);
    }

    // Период перехода: пока он идёт, запросы уходят сразу на запасную.
    if (now() < (fallbackUntil.get(req.model) ?? 0)) {
      return perform(req, apiKey, fallback, MAX_ATTEMPTS);
    }

    // Обычный режим: одна попытка основной, при отказе сервера — одна запасной.
    try {
      return await perform(req, apiKey, req.model, 1);
    } catch (error) {
      if (error instanceof CancelledError || !isTransition(error)) {
        throw error;
      }
      fallbackUntil.set(req.model, now() + fallbackWindowMs);
      const reason = error instanceof LlmError ? error.kind : 'network';
      opts.onFallback?.({ from: req.model, to: fallback, reason });
      opts.mark?.('model.fallback', { from: req.model, to: fallback, reason });
      return perform(req, apiKey, fallback, 1);
    }
  }

  return { chat };
}
