// Отрезки занятости Тишки: обдумывание, речь и работа. Нужны правилу времени
// начала фразы: репликой не становится сказанное, пока Тишка был занят, даже
// если между обдумыванием и речью был короткий простой. Хранится не один
// последний отрезок, а все за последние две минуты; соседние отрезки с
// промежутком меньше полутора секунд склеиваются, старые уходят сами.

export type BusyReason = 'thinking' | 'speech' | 'work';

export interface BusyInterval {
  start: number;
  end: number;
  reason: BusyReason;
}

export const BUSY_WINDOW_MS = 120_000;
export const BUSY_MERGE_MS = 1_500;

export interface BusyIntervalsOptions {
  now?(): number;
  windowMs?: number;
  mergeMs?: number;
}

export interface BusyIntervals {
  // Тишка занят: открыть отрезок или уточнить причину уже открытого.
  begin(reason: BusyReason, at?: number): void;
  // Занятость кончилась: закрыть открытый отрезок.
  finish(at?: number): void;
  // Пересекается ли запись, начатая в момент `at`, с занятостью.
  intersects(at: number): boolean;
  // Замкнутые отрезки, старые первыми (для наблюдения и тестов).
  list(at?: number): BusyInterval[];
  clear(): void;
}

interface OpenInterval {
  start: number;
  reason: BusyReason;
}

export function createBusyIntervals(options: BusyIntervalsOptions = {}): BusyIntervals {
  const now = options.now ?? ((): number => Date.now());
  const windowMs = options.windowMs ?? BUSY_WINDOW_MS;
  const mergeMs = options.mergeMs ?? BUSY_MERGE_MS;
  let closed: BusyInterval[] = [];
  let open: OpenInterval | null = null;

  function prune(at: number): void {
    const limit = at - windowMs;
    closed = closed.filter((interval) => interval.end >= limit);
  }

  function compact(): void {
    const merged: BusyInterval[] = [];
    for (const interval of closed) {
      const last = merged[merged.length - 1];
      if (last !== undefined && interval.start - last.end < mergeMs) {
        last.end = Math.max(last.end, interval.end);
        continue;
      }
      merged.push({ ...interval });
    }
    closed = merged;
  }

  function close(at: number): void {
    if (open === null) {
      return;
    }
    closed.push({ start: open.start, end: at, reason: open.reason });
    open = null;
    compact();
    prune(at);
  }

  return {
    begin(reason, at = now()): void {
      if (open !== null) {
        open.reason = reason;
        return;
      }
      prune(at);
      open = { start: at, reason };
    },
    finish(at = now()): void {
      close(at);
    },
    intersects(at: number): boolean {
      prune(now());
      for (const interval of closed) {
        if (at >= interval.start && at < interval.end) {
          return true;
        }
      }
      return open !== null && at >= open.start;
    },
    list(at = now()): BusyInterval[] {
      prune(at);
      return closed.map((interval) => ({ ...interval }));
    },
    clear(): void {
      closed = [];
      open = null;
    }
  };
}
