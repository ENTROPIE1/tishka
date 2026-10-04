import type { ChatRequest, ChatResponse, LlmApi } from './protocol';
import { LlmError } from './protocol';
import { CancelledError } from '../cancel';
import { chatWireBody, parseResponse } from './chat-format';
import { parseResponsesResponse, responseFromEventStream, toResponsesRequest } from './responses-format';

export type { ChatMessage, ChatRequest, ChatResponse, ContentPart, ToolCall } from './protocol';
export type { LlmApi, LlmErrorKind } from './protocol';
export { LlmError } from './protocol';

export interface LlmClientOptions {
  baseUrl: string | (() => string);
  getApiKey: () => Promise<string | undefined>;
  api?: LlmApi | (() => LlmApi);   // формат запросов; нет или неизвестно — 'chat'
  fetch?: typeof fetch;
}

const TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [1000, 3000, 7000];
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const EVENT_STREAM_TYPE = 'text/event-stream';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

function statusToError(status: number): LlmError {
  if (status === 401 || status === 403) {
    return new LlmError('auth', 'Ключ шлюза моделей отклонён');
  }
  if (status === 429) {
    return new LlmError('limit', 'Шлюз моделей просит снизить частоту запросов');
  }
  if (status >= 500) {
    return new LlmError('server', `Шлюз моделей недоступен, код ответа ${status}`);
  }
  return new LlmError('bad_response', `Шлюз моделей отклонил запрос, код ответа ${status}`);
}

export function createLlmClient(opts: LlmClientOptions): {
  chat(req: ChatRequest): Promise<ChatResponse>;
} {
  const doFetch = opts.fetch ?? fetch;
  const resolveBaseUrl = (): string => {
    const raw = typeof opts.baseUrl === 'function' ? opts.baseUrl() : opts.baseUrl;
    return raw.replace(/\/+$/, '');
  };
  const resolveApi = (): LlmApi => {
    const raw = typeof opts.api === 'function' ? opts.api() : opts.api;
    return raw === 'responses' ? 'responses' : 'chat';
  };

  function wireRequest(
    req: ChatRequest,
    api: LlmApi,
    base: string
  ): { url: string; body: string } {
    if (api === 'responses') {
      return { url: `${base}/responses`, body: JSON.stringify(toResponsesRequest(req)) };
    }
    return { url: `${base}/chat/completions`, body: JSON.stringify(chatWireBody(req)) };
  }

  async function requestOnce(req: ChatRequest, apiKey: string, api: LlmApi): Promise<Response> {
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
    const wire = wireRequest(req, api, resolveBaseUrl());
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

  async function chat(req: ChatRequest): Promise<ChatResponse> {
    const apiKey = await opts.getApiKey();
    if (apiKey === undefined || apiKey.length === 0) {
      throw new LlmError('auth', 'Не задан ключ шлюза моделей');
    }

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      if (req.signal?.aborted) {
        throw new CancelledError();
      }
      const api = resolveApi();
      let response: Response;
      try {
        response = await requestOnce(req, apiKey, api);
      } catch {
        // Отмена человеком — не сетевой сбой: без повторных попыток.
        if (req.signal?.aborted) {
          throw new CancelledError();
        }
        if (attempt < MAX_ATTEMPTS - 1) {
          await delay(RETRY_DELAYS_MS[attempt]);
          continue;
        }
        throw new LlmError('network', 'Не удалось связаться со шлюзом моделей');
      }

      if (response.ok) {
        if (req.signal?.aborted) {
          throw new CancelledError();
        }
        return readOk(response, api);
      }

      const error = statusToError(response.status);
      const retryable = RETRYABLE_STATUSES.has(response.status);
      if (retryable && attempt < MAX_ATTEMPTS - 1) {
        const retryAfter = parseRetryAfter(response.headers.get('Retry-After'));
        await delay(retryAfter ?? RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw error;
    }

    throw new LlmError('server', 'Шлюз моделей недоступен');
  }

  return { chat };
}
