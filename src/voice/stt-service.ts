import { spawn, type ChildProcess } from 'node:child_process';
import { dirname } from 'node:path';
import type { Config } from '../core/types';

export type SttStatus = 'off' | 'starting' | 'ready' | 'error';

export type TranscribeResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

export interface SttServiceOptions {
  getConfig: () => Config['voice'];
  spawn?: typeof import('node:child_process').spawn;
  fetch?: typeof fetch;
}

export interface SttService {
  start(): Promise<{ ok: boolean; error?: string }>;
  stop(): void;
  transcribe(wav: Uint8Array): Promise<TranscribeResult>;
  status(): SttStatus;
}

const READY_TIMEOUT_MS = 30000;
const REQUEST_TIMEOUT_MS = 30000;
const POLL_MS = 300;
const NON_ASCII = /[^\x00-\x7F]/;
const CYRILLIC_ERROR = 'Путь к службе распознавания должен быть без кириллицы';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function baseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function inferenceUrl(url: string): string {
  return `${baseUrl(url)}/inference`;
}

function servicePort(url: string): number {
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

function hasForeignChars(path: string): boolean {
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

export function createSttService(options: SttServiceOptions): SttService {
  const spawnFn = options.spawn ?? spawn;
  const fetchFn = options.fetch ?? fetch;
  let state: SttStatus = 'off';
  let child: ChildProcess | undefined;

  function stopProcess(): void {
    const running = child;
    child = undefined;
    if (running !== undefined) {
      try {
        running.kill();
      } catch {
        // Процесс уже завершился — останавливать нечего.
      }
    }
  }

  async function probe(url: string): Promise<boolean> {
    try {
      const response = await fetchFn(`${baseUrl(url)}/`, { method: 'GET' });
      return response.ok;
    } catch {
      return false;
    }
  }

  async function waitReady(url: string): Promise<boolean> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await probe(url)) {
        return true;
      }
      if (Date.now() >= deadline) {
        break;
      }
      await delay(POLL_MS);
    }
    return false;
  }

  async function start(): Promise<{ ok: boolean; error?: string }> {
    const config = options.getConfig();
    const exe = config.stt.exe.trim();

    if (exe !== '') {
      if (hasForeignChars(exe) || hasForeignChars(config.stt.model)) {
        state = 'error';
        return { ok: false, error: CYRILLIC_ERROR };
      }
      state = 'starting';
      const args = [
        '-m', config.stt.model,
        '-l', 'ru',
        '-t', String(config.stt.threads),
        '-ac', String(config.stt.audioCtx),
        '--host', '127.0.0.1',
        '--port', String(servicePort(config.sttUrl))
      ];
      try {
        child = spawnFn(exe, args, { cwd: dirname(exe), windowsHide: true, stdio: 'ignore' });
      } catch {
        state = 'error';
        return { ok: false, error: 'Не удалось запустить службу распознавания' };
      }
      if (typeof child.on === 'function') {
        child.on('error', () => {
          state = 'error';
        });
      }
    } else if (state !== 'ready' && state !== 'starting') {
      state = 'starting';
    }

    const ready = await waitReady(config.sttUrl);
    if (!ready) {
      stopProcess();
      state = 'error';
      return { ok: false, error: 'Служба распознавания не ответила за 30 секунд' };
    }
    state = 'ready';
    return { ok: true };
  }

  async function transcribe(wav: Uint8Array): Promise<TranscribeResult> {
    const config = options.getConfig();
    const bytes = new Uint8Array(wav.length);
    bytes.set(wav);
    const form = new FormData();
    form.append('file', new Blob([bytes.buffer], { type: 'audio/wav' }), 'audio.wav');
    form.append('response_format', 'json');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchFn(inferenceUrl(config.sttUrl), {
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

  return {
    start,
    stop(): void {
      stopProcess();
      state = 'off';
    },
    transcribe,
    status: () => state
  };
}
