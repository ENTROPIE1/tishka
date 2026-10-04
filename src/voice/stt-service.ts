import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Config } from '../core/types';
import { delayOrWake, reasonFromExit, RunController, type RunToken } from './stt-run';
import {
  hasForeignChars,
  probe,
  PROBE_TIMEOUT_MS,
  servicePort,
  transcribeHttp,
  type TranscribeResult
} from './stt-http';

export type SttStatus = 'off' | 'starting' | 'ready' | 'error';
export type { TranscribeResult } from './stt-http';

export interface SttServiceOptions {
  getConfig: () => Config['voice'];
  spawn?: typeof import('node:child_process').spawn;
  fetch?: typeof fetch;
  fileExists?: (path: string) => boolean;
}

export interface SttService {
  start(): Promise<{ ok: boolean; error?: string }>;
  stop(): void;
  transcribe(wav: Uint8Array, prompt?: string): Promise<TranscribeResult>;
  status(): SttStatus;
  pid(): number | undefined;
}

const READY_TIMEOUT_MS = 30000;
const POLL_MS = 300;
const OUTPUT_LIMIT = 2000;
const CYRILLIC_ERROR = 'Путь к службе распознавания должен быть без кириллицы';
export const START_CANCELLED = 'Запуск отменён';
const NOT_CONFIGURED = 'Распознавание речи не настроено';

export function createSttService(options: SttServiceOptions): SttService {
  const spawnFn = options.spawn ?? spawn;
  const fetchFn = options.fetch ?? fetch;
  const fileExists = options.fileExists ?? existsSync;
  const runs = new RunController();
  let state: SttStatus = 'off';
  let child: ChildProcess | undefined;
  let childRunId = 0;
  function killOwnProcess(id: number): void {
    if (childRunId !== id) {
      return;
    }
    const running = child;
    child = undefined;
    childRunId = 0;
    if (running !== undefined) {
      try {
        running.kill();
      } catch {
        // Процесс уже завершился — останавливать нечего.
      }
    }
  }
  function spawnProcess(run: RunToken, exe: string, model: string, url: string): void {
    const config = options.getConfig();
    const args = [
      '-m', model,
      '-l', 'ru',
      '-t', String(config.stt.threads),
      '-ac', String(config.stt.audioCtx),
      '--host', '127.0.0.1',
      '--port', String(servicePort(url))
    ];
    const spawned = spawnFn(exe, args, {
      cwd: dirname(exe),
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    });
    child = spawned;
    childRunId = run.id;
    let tail = '';
    spawned.stderr?.on('data', (chunk: Buffer | string) => {
      tail = (tail + String(chunk)).slice(-OUTPUT_LIMIT);
    });
    spawned.on('error', (error: Error & { code?: string }) => {
      if (run.failure === undefined) {
        run.failure = error.code === 'ENOENT' ? 'файл не найден' : error.message;
      }
      run.wake?.();
    });
    spawned.on('exit', (code: number | null) => {
      if (childRunId === run.id) {
        child = undefined;
        childRunId = 0;
      }
      if (run.failure === undefined) {
        run.failure = reasonFromExit(code, tail);
      }
      run.wake?.();
    });
  }
  async function waitReady(run: RunToken, url: string): Promise<'ready' | 'cancelled' | 'failed' | 'timeout'> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (run.failure === undefined && !run.cancelled) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        return 'timeout';
      }
      if (await probe(fetchFn, url, Math.min(PROBE_TIMEOUT_MS, remaining))) {
        return 'ready';
      }
      const left = deadline - Date.now();
      if (left <= 0) {
        return 'timeout';
      }
      await delayOrWake(run, Math.min(POLL_MS, left));
    }
    return run.cancelled ? 'cancelled' : 'failed';
  }
  async function start(): Promise<{ ok: boolean; error?: string }> {
    const config = options.getConfig();
    const exe = config.stt.exe.trim();
    const model = config.stt.model.trim();
    const run = runs.begin();

    if (exe === '') {
      const alive = await probe(fetchFn, config.sttUrl);
      if (run.cancelled) {
        return { ok: false, error: START_CANCELLED };
      }
      state = alive ? 'ready' : 'off';
      return alive ? { ok: true } : { ok: false, error: NOT_CONFIGURED };
    }

    if (hasForeignChars(exe) || hasForeignChars(model)) {
      state = 'error';
      return { ok: false, error: CYRILLIC_ERROR };
    }

    if (await probe(fetchFn, config.sttUrl)) {
      if (run.cancelled) {
        return { ok: false, error: START_CANCELLED };
      }
      state = 'ready';
      return { ok: true };
    }
    if (run.cancelled) {
      return { ok: false, error: START_CANCELLED };
    }

    if (!fileExists(exe)) {
      state = 'error';
      return { ok: false, error: `Не найден файл программы: ${exe}` };
    }
    if (!fileExists(model)) {
      state = 'error';
      return { ok: false, error: `Не найден файл модели: ${model}` };
    }

    state = 'starting';
    try {
      spawnProcess(run, exe, model, config.sttUrl);
    } catch {
      state = 'error';
      return { ok: false, error: 'Служба распознавания не запустилась: файл не найден' };
    }

    const outcome = await waitReady(run, config.sttUrl);
    if (outcome === 'ready') {
      state = 'ready';
      return { ok: true };
    }
    if (outcome === 'cancelled') {
      killOwnProcess(run.id);
      return { ok: false, error: START_CANCELLED };
    }
    killOwnProcess(run.id);
    state = 'error';
    if (outcome === 'failed') {
      return { ok: false, error: `Служба распознавания не запустилась: ${run.failure ?? ''}` };
    }
    return { ok: false, error: 'Служба распознавания не ответила за 30 секунд' };
  }

  function stop(): void {
    runs.cancel();
    killOwnProcess(childRunId);
    state = 'off';
  }

  return {
    start,
    stop,
    transcribe: (wav, prompt) => transcribeHttp(fetchFn, options.getConfig().sttUrl, wav, prompt),
    status: () => state,
    pid: () => {
      const config = options.getConfig();
      return config.stt.exe.trim() === '' || config.stt.model.trim() === '' ? undefined : child?.pid;
    }
  };
}
