import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

export type RunTasklist = (pid: number) => Promise<string>;

export interface ProcessMemoryOptions {
  getPid: () => number | undefined;
  run?: RunTasklist;              // запуск tasklist, подменяется в тестах
  platform?: NodeJS.Platform;
  now?: () => number;
  minIntervalMs?: number;
}

export interface ProcessMemory {
  current(): number;              // последнее измерение, МБ
  refresh(): Promise<void>;
}

const DEFAULT_MIN_INTERVAL_MS = 30000;
const execFile = promisify(execFileCallback);

function tasklist(pid: number): Promise<string> {
  return execFile('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']).then((result) => result.stdout);
}

// Разбирает CSV-строку tasklist: последнее поле — память в килобайтах.
// Из него берутся только цифры: на русской Windows разделитель разрядов и «КБ»
// после чтения вывода как utf8 превращаются в знаки замены U+FFFD и иные знаки.
export function parseTasklistMemory(output: string): number {
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') {
      continue;
    }
    const fields = line.split('","').map((part) => part.replace(/^"|"$/g, ''));
    if (fields.length !== 5) {
      continue;
    }
    const digits = (fields[4] ?? '').replace(/\D/g, '');
    if (digits === '') {
      continue;
    }
    return Math.round(Number(digits) / 1024);
  }
  return 0;
}

export function createProcessMemory(options: ProcessMemoryOptions): ProcessMemory {
  const run = options.run ?? tasklist;
  const platform = options.platform ?? process.platform;
  const now = options.now ?? ((): number => Date.now());
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  let last = 0;
  let lastAt = -Infinity;

  async function refresh(): Promise<void> {
    const at = now();
    if (at - lastAt < minIntervalMs) {
      return;
    }
    lastAt = at;
    const pid = options.getPid();
    if (platform !== 'win32' || pid === undefined) {
      last = 0;
      return;
    }
    try {
      last = parseTasklistMemory(await run(pid));
    } catch {
      last = 0;
    }
  }

  return { current: () => last, refresh };
}
