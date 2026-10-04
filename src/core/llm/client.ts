import type { ToolDef } from '../types';

export type ContentPart = { type: 'text'; text: string } | { type: 'image'; dataUrl: string };

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string | ContentPart[] }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  temperature?: number;
}

export interface ChatResponse {
  text: string | null;
  toolCalls: ToolCall[];
}

export type LlmErrorKind = 'auth' | 'limit' | 'network' | 'server' | 'bad_response';

export class LlmError extends Error {
  readonly kind: LlmErrorKind;

  constructor(kind: LlmErrorKind, message: string) {
    super(message);
    this.name = 'LlmError';
    this.kind = kind;
  }
}

export interface LlmClientOptions {
  baseUrl: string | (() => string);
  getApiKey: () => Promise<string | undefined>;
  fetch?: typeof fetch;
}

const TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [1000, 3000, 7000];
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

function toWireContent(
  content: string | ContentPart[]
): string | Array<Record<string, unknown>> {
  if (typeof content === 'string') {
    return content;
  }
  return content.map((part) =>
    part.type === 'text'
      ? { type: 'text', text: part.text }
      : { type: 'image_url', image_url: { url: part.dataUrl } }
  );
}

function toWireMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
  }
  if (message.role === 'assistant') {
    const wire: Record<string, unknown> = { role: 'assistant', content: message.content };
    if (message.toolCalls !== undefined && message.toolCalls.length > 0) {
      wire.tool_calls = message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.args) }
      }));
    }
    return wire;
  }
  return { role: message.role, content: toWireContent(message.content) };
}

function toWireTools(tools: ToolDef[] | undefined): Array<Record<string, unknown>> | undefined {
  if (tools === undefined || tools.length === 0) {
    return undefined;
  }
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema
    }
  }));
}

function parseToolCall(value: unknown): ToolCall {
  const source = isRecord(value) ? value : {};
  const fn = isRecord(source.function) ? source.function : {};
  const id = typeof source.id === 'string' ? source.id : '';
  const name = typeof fn.name === 'string' ? fn.name : '';
  let args: Record<string, unknown> = {};
  if (typeof fn.arguments === 'string' && fn.arguments.length > 0) {
    try {
      const parsed: unknown = JSON.parse(fn.arguments);
      if (isRecord(parsed)) {
        args = parsed;
      }
    } catch {
      args = {};
    }
  } else if (isRecord(fn.arguments)) {
    args = fn.arguments;
  }
  return { id, name, args };
}

function parseResponse(payload: unknown): ChatResponse {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || payload.choices.length === 0) {
    throw new LlmError('bad_response', 'Шлюз моделей вернул ответ неожиданного вида');
  }
  const first = payload.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) {
    throw new LlmError('bad_response', 'Шлюз моделей вернул ответ неожиданного вида');
  }
  const message = first.message;
  const text = typeof message.content === 'string' ? message.content : null;
  const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const toolCalls = rawCalls.map(parseToolCall);
  return { text, toolCalls };
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

  async function requestOnce(req: ChatRequest, apiKey: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, TIMEOUT_MS);
    try {
      return await doFetch(`${resolveBaseUrl()}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: req.model,
          messages: req.messages.map(toWireMessage),
          tools: toWireTools(req.tools),
          temperature: req.temperature
        }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function chat(req: ChatRequest): Promise<ChatResponse> {
    const apiKey = await opts.getApiKey();
    if (apiKey === undefined || apiKey.length === 0) {
      throw new LlmError('auth', 'Не задан ключ шлюза моделей');
    }

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      let response: Response;
      try {
        response = await requestOnce(req, apiKey);
      } catch {
        if (attempt < MAX_ATTEMPTS - 1) {
          await delay(RETRY_DELAYS_MS[attempt]);
          continue;
        }
        throw new LlmError('network', 'Не удалось связаться со шлюзом моделей');
      }

      if (response.ok) {
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw new LlmError('bad_response', 'Шлюз моделей вернул ответ неожиданного вида');
        }
        return parseResponse(payload);
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
