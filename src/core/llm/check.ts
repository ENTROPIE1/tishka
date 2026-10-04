import { DEFAULT_TIMEOUT_MS, fetchModels, modelMissing, probeChat, probeResponses } from './gateway-http';
import type { LlmApi } from './protocol';
import { normalizeBaseUrl } from './gateway-url';

export { normalizeBaseUrl } from './gateway-url';
export type { NormalizeBaseUrlResult } from './gateway-url';

export interface GatewayCheckResult {
  ok: boolean;
  models: string[];
  error?: string;
  ms: number;
}

export interface GatewayCheckRequest {
  baseUrl: string;
  model: string;
  apiKey: string;
  api?: LlmApi;   // нет или неизвестно — 'chat'
}

export interface GatewayCheckOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export async function checkGateway(
  req: GatewayCheckRequest,
  options: GatewayCheckOptions = {}
): Promise<GatewayCheckResult> {
  const started = Date.now();
  const elapsed = (): number => Date.now() - started;
  const normalized = normalizeBaseUrl(req.baseUrl);
  if (!normalized.ok) {
    return { ok: false, models: [], error: normalized.error, ms: elapsed() };
  }

  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const models = await fetchModels(doFetch, normalized.value, req.apiKey, timeoutMs);
  if (!models.ok) {
    return { ok: false, models: [], error: models.error, ms: elapsed() };
  }

  // Список получен — ключ принят. Известные модели проверяем без запроса к чату.
  if (models.models.length > 0 && !models.models.includes(req.model)) {
    return { ok: false, models: models.models, error: modelMissing(req.model), ms: elapsed() };
  }

  const api: LlmApi = req.api === 'responses' ? 'responses' : 'chat';
  const probe = api === 'responses' ? probeResponses : probeChat;
  const error = await probe(doFetch, normalized.value, req, timeoutMs, models.present);
  if (error !== undefined) {
    return { ok: false, models: models.models, error, ms: elapsed() };
  }
  return { ok: true, models: models.models, ms: elapsed() };
}
