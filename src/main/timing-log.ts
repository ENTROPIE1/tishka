import { appendFileSync, statSync, writeFileSync } from 'node:fs';

export type TimingDetails = Record<string, string | number | boolean>;
export type TimingMark = (event: string, details?: TimingDetails) => void;

export interface TimingLogOptions {
  filePath: string;
  version: string;
  now?: () => number;              // текущее время в мс, подменяется в тестах
  startedAt?: number;              // момент старта процесса в мс
  maxBytes?: number;               // при превышении файл начинается заново
  write?: (filePath: string, text: string) => void;
  size?: (filePath: string) => number;
  resetFile?: (filePath: string) => void;
}

export interface TimingLog {
  mark(event: string, details?: TimingDetails): void;
  filePath: string;
}

export const TIMING_LOG_NAME = 'timing.log';
export const TIMING_LOG_MAX_BYTES = 1024 * 1024;
const MAX_EVENT_LENGTH = 80;

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

// Размер файла не должен ронять журнал: недоступный файл считается пустым.
function fileSize(filePath: string, size?: (filePath: string) => number): number {
  if (size !== undefined) {
    try {
      return size(filePath);
    } catch {
      return 0;
    }
  }
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

export function formatDetails(details?: TimingDetails): string {
  if (details === undefined) {
    return '';
  }
  const parts: string[] = [];
  for (const [key, value] of Object.entries(details)) {
    parts.push(`${oneLine(key)}=${oneLine(String(value))}`);
  }
  return parts.length === 0 ? '' : ` ${parts.join(' ')}`;
}

// Одна строка журнала: время ISO, мс от старта, мс от прошлой отметки, событие, детали.
export function formatTimingLine(
  at: number,
  sinceStart: number,
  sincePrev: number,
  event: string,
  details?: TimingDetails
): string {
  const time = new Date(at).toISOString();
  return `${time} +${sinceStart}ms +${sincePrev}ms ${oneLine(event).slice(0, MAX_EVENT_LENGTH)}${formatDetails(details)}`;
}

export function createTimingLog(options: TimingLogOptions): TimingLog {
  const now = options.now ?? ((): number => Date.now());
  const startedAt = options.startedAt ?? now();
  const maxBytes = options.maxBytes ?? TIMING_LOG_MAX_BYTES;
  const write = options.write ?? ((filePath: string, text: string): void => appendFileSync(filePath, text));
  const resetFile = options.resetFile ?? ((filePath: string): void => writeFileSync(filePath, ''));
  let previous = startedAt;

  function safeWrite(text: string): void {
    try {
      write(options.filePath, text);
    } catch {
      // Ошибка журнала не должна мешать приложению.
    }
  }

  // Строка-разделитель с версией: видно, где начинается очередной запуск.
  safeWrite(`--- timing start ${new Date(startedAt).toISOString()} version=${oneLine(options.version)} ---\n`);

  function mark(event: string, details?: TimingDetails): void {
    try {
      const at = now();
      const sinceStart = at - startedAt;
      const sincePrev = at - previous;
      previous = at;
      if (fileSize(options.filePath, options.size) > maxBytes) {
        try {
          resetFile(options.filePath);
        } catch {
          // Файл мог исчезнуть — запись всё равно попробуем.
        }
      }
      safeWrite(`${formatTimingLine(at, sinceStart, sincePrev, event, details)}\n`);
    } catch {
      // Журнал не влияет на работу приложения.
    }
  }

  return { mark, filePath: options.filePath };
}

let active: TimingLog | undefined;

export function setTimingLog(log: TimingLog | undefined): void {
  active = log;
}

export function mark(event: string, details?: TimingDetails): void {
  active?.mark(event, details);
}

export function timingLogFilePath(): string | undefined {
  return active?.filePath;
}
