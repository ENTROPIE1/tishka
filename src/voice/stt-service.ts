import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Config } from '../core/types';
import type { TimingMark } from '../main/timing-log';
import { waitSttReady } from './stt-ready';
import { reasonFromExit, RunController, type RunToken } from './stt-run';
import {
  buildServiceArgs,
  detectorState,
  findVadModel,
  parseHelpCaps,
  type HelpCaps,
  type SttDetector
} from './stt-flags';
import {
  hasForeignChars,
  probe,
  servicePort,
  transcribeHttp,
  type TranscribeResult
} from './stt-http';

export type SttStatus = 'off' | 'starting' | 'ready' | 'error';
export type { SttCheckView, TranscribeResult } from './stt-http';
export type { SttDetector } from './stt-flags';

export interface SttServiceOptions {
  getConfig: () => Config['voice'];
  spawn?: typeof import('node:child_process').spawn;
  spawnHelp?: typeof import('node:child_process').spawn;
  fetch?: typeof fetch;
  fileExists?: (path: string) => boolean;
  readHelp?: (exe: string) => string | Promise<string>;   // справка программы для выбора ключей запуска
  listDir?: (dir: string) => string[];            // соседние с моделью файлы: поиск модели детектора
  mark?: TimingMark;
  onStatusChange?: (status: SttStatus) => void;   // переход состояния готовой службы по адресу
  remotePollMs?: { down?: number; up?: number };  // период повторной проверки адреса
}

export interface SttService {
  start(): Promise<{ ok: boolean; error?: string }>;
  stop(): void;
  transcribe(wav: Uint8Array, prompt?: string): Promise<TranscribeResult>;
  status(): SttStatus;
  detector(): SttDetector;
  pid(): number | undefined;
}

const OUTPUT_LIMIT = 2000;
const CYRILLIC_ERROR = 'Путь к службе распознавания должен быть без кириллицы';
export const START_CANCELLED = 'Запуск отменён';
const NOT_CONFIGURED = 'Распознавание речи не настроено';
export const REMOTE_UNREACHABLE = 'Служба распознавания не отвечает по адресу';
// Готовая служба по адресу может появиться позже приложения (туннель поднят
// после запуска) или пропасть. Пока не отвечает — проверяем чаще.
const REMOTE_POLL_DOWN_MS = 5000;
const REMOTE_POLL_UP_MS = 30000;
const HELP_TIMEOUT_MS = 5000;

// Справка программы: -sns и --vad есть не во всех сборках. Незнакомая или
// недоступная программа даёт пустую справку — запуск как раньше. Читается
// асинхронно и с пределом времени: зависшая программа не останавливает процесс.
function defaultReadHelp(spawnFn: typeof spawn, exe: string): Promise<string> {
  return new Promise<string>((resolve) => {
    let output = '';
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let child: ChildProcess;
    const finish = (): void => {
      if (done) {
        return;
      }
      done = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      resolve(output);
    };
    try {
      child = spawnFn(exe, ['--help'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch {
      resolve('');
      return;
    }
    timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Процесс уже завершился — останавливать нечего.
      }
      finish();
    }, HELP_TIMEOUT_MS);
    child.stdout?.on('data', (chunk: Buffer | string) => {
      output += String(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer | string) => {
      output += String(chunk);
    });
    child.on('error', finish);
    child.on('exit', finish);
  });
}

function defaultListDir(dir: string): string[] {
  return readdirSync(dir);
}

export function createSttService(options: SttServiceOptions): SttService {
  const spawnFn = options.spawn ?? spawn;
  const spawnHelp = options.spawnHelp ?? spawn;
  const fetchFn = options.fetch ?? fetch;
  const fileExists = options.fileExists ?? existsSync;
  const readHelp = options.readHelp ?? ((exe: string) => defaultReadHelp(spawnHelp, exe));
  const listDir = options.listDir ?? defaultListDir;
  const mark = options.mark;
  const runs = new RunController();
  let state: SttStatus = 'off';
  let detector: SttDetector = 'off';
  let child: ChildProcess | undefined;
  let childRunId = 0;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;

  // Сообщаем окнам о переходе состояния, случившемся в фоне (повторная
  // проверка адреса). Результат явного start() окна получают как обычно.
  function announce(next: SttStatus): void {
    if (state === next) {
      return;
    }
    state = next;
    options.onStatusChange?.(next);
  }

  function stopPolling(): void {
    if (pollTimer !== undefined) {
      clearTimeout(pollTimer);
      pollTimer = undefined;
    }
  }

  // Повторная проверка готовой службы по адресу: пока не отвечает — раз в 5
  // секунд, пока отвечает — раз в 30 секунд, чтобы заметить пропажу.
  function pollRemote(run: RunToken): void {
    stopPolling();
    const downMs = options.remotePollMs?.down ?? REMOTE_POLL_DOWN_MS;
    const upMs = options.remotePollMs?.up ?? REMOTE_POLL_UP_MS;
    function schedule(delayMs: number): void {
      if (run.cancelled) {
        return;
      }
      pollTimer = setTimeout(() => {
        void tick();
      }, delayMs);
      pollTimer.unref?.();
    }
    async function tick(): Promise<void> {
      if (run.cancelled) {
        return;
      }
      const startedAt = Date.now();
      const alive = await probe(fetchFn, options.getConfig().sttUrl);
      if (run.cancelled) {
        return;
      }
      announce(alive ? 'ready' : 'off');
      mark?.('stt.ready', { ok: alive, probe: true });
      const interval = alive ? upMs : downMs;
      schedule(Math.max(0, interval - (Date.now() - startedAt)));
    }
    schedule(state === 'ready' ? upMs : downMs);
  }

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
  function spawnProcess(run: RunToken, exe: string, model: string, url: string, caps: HelpCaps, vadModel: string | undefined): void {
    const config = options.getConfig();
    const base = [
      '-m', model,
      '-l', 'ru',
      '-t', String(config.stt.threads),
      '-ac', String(config.stt.audioCtx),
      '--host', '127.0.0.1',
      '--port', String(servicePort(url))
    ];
    const args = buildServiceArgs(base, caps, vadModel);
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
  async function start(): Promise<{ ok: boolean; error?: string }> {
    const config = options.getConfig();
    const exe = config.stt.exe.trim();
    const model = config.stt.model.trim();
    const run = runs.begin();
    // Ключи запуска известны только для своей службы; чужая — без детектора.
    detector = 'off';

    // Готовая служба по адресу: состояние определяет проверка, чужой процесс
    // не запускаем и не останавливаем. Явный запуск тоже объявляет переход,
    // чтобы окна узнали о нём сразу, а не от следующей фоновой проверки.
    if (config.stt.mode === 'remote') {
      const alive = await probe(fetchFn, config.sttUrl);
      if (run.cancelled) {
        return { ok: false, error: START_CANCELLED };
      }
      announce(alive ? 'ready' : 'off');
      mark?.('stt.ready', { ok: alive, probe: true });
      pollRemote(run);
      return alive ? { ok: true } : { ok: false, error: REMOTE_UNREACHABLE };
    }

    if (exe === '') {
      const alive = await probe(fetchFn, config.sttUrl);
      if (run.cancelled) {
        return { ok: false, error: START_CANCELLED };
      }
      announce(alive ? 'ready' : 'off');
      mark?.('stt.ready', { ok: alive, probe: true });
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
      announce('ready');
      mark?.('stt.ready', { probe: true });
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
    let help = '';
    try {
      help = await readHelp(exe);
    } catch {
      help = '';
    }
    const caps = parseHelpCaps(help);
    const vadModel = caps.vad ? findVadModel(model, listDir) : undefined;
    detector = detectorState(caps, vadModel);
    try {
      spawnProcess(run, exe, model, config.sttUrl, caps, vadModel);
      mark?.('stt.launch', { port: servicePort(config.sttUrl), detector });
    } catch {
      state = 'error';
      return { ok: false, error: 'Служба распознавания не запустилась: файл не найден' };
    }

    const outcome = await waitSttReady(run, config.sttUrl, fetchFn, mark);
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
      mark?.('stt.ready', { ok: false, reason: 'failed' });
      return { ok: false, error: `Служба распознавания не запустилась: ${run.failure ?? ''}` };
    }
    mark?.('stt.ready', { ok: false, reason: 'timeout' });
    return { ok: false, error: 'Служба распознавания не ответила за 30 секунд' };
  }

  function stop(): void {
    runs.cancel();
    stopPolling();
    killOwnProcess(childRunId);
    state = 'off';
    detector = 'off';
  }

  return {
    start,
    stop,
    transcribe: (wav, prompt) => transcribeHttp(fetchFn, options.getConfig().sttUrl, wav, prompt, mark),
    status: () => state,
    detector: () => detector,
    pid: () => {
      const config = options.getConfig();
      return config.stt.exe.trim() === '' || config.stt.model.trim() === '' ? undefined : child?.pid;
    }
  };
}
