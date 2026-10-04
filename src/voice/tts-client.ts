export type TtsHealth = { ok: true; engine: string; voice: string } | { ok: false; error: string };

export type TtsSynthesis = { ok: true; wav: Uint8Array } | { ok: false; error: string };

export interface TtsClient {
  health(): Promise<TtsHealth>;
  synthesize(text: string): Promise<TtsSynthesis>;
}

export interface TtsClientOptions {
  url: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const REQUEST_TIMEOUT_MS = 15000;

function baseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function errorFor(error: unknown, timeoutMessage: string, connectionMessage: string): string {
  if (error instanceof Error && error.name === 'AbortError') {
    return timeoutMessage;
  }
  return connectionMessage;
}

export function createTtsClient(options: TtsClientOptions): TtsClient {
  const fetchFn = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  async function request(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchFn(`${baseUrl(options.url)}${path}`, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async health(): Promise<TtsHealth> {
      try {
        const response = await request('/health', { method: 'GET' });
        if (!response.ok) {
          return { ok: false, error: `Служба синтеза ответила с ошибкой ${response.status}` };
        }
        const data: unknown = await response.json();
        if (!isRecord(data) || data.status !== 'ok') {
          return { ok: false, error: 'Служба синтеза вернула неожиданный ответ' };
        }
        return {
          ok: true,
          engine: typeof data.engine === 'string' ? data.engine : '',
          voice: typeof data.voice === 'string' ? data.voice : ''
        };
      } catch (error) {
        return {
          ok: false,
          error: errorFor(error, 'Служба синтеза не ответила вовремя', 'Не удалось обратиться к службе синтеза')
        };
      }
    },

    async synthesize(text: string): Promise<TtsSynthesis> {
      try {
        const response = await request('/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        });
        if (!response.ok) {
          return { ok: false, error: `Служба синтеза ответила с ошибкой ${response.status}` };
        }
        const buffer = await response.arrayBuffer();
        return { ok: true, wav: new Uint8Array(buffer) };
      } catch (error) {
        return {
          ok: false,
          error: errorFor(error, 'Служба синтеза не ответила вовремя', 'Не удалось обратиться к службе синтеза')
        };
      }
    }
  };
}
