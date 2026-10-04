export interface MemoryMetrics {
  appMb: number;    // сумма памяти процессов приложения
  sttMb: number;    // память службы распознавания
}

export interface MemoryWatchDeps {
  getMetrics(): MemoryMetrics;
  getLimitMb(): number;
  isIdle(): boolean;              // нет разговора и выполняющейся просьбы
  reloadWindows(): void;          // перезагрузить окно-питомец и окно чата
  notify(text: string): void;     // одно уведомление перед перезапуском
  relaunch(): void;               // app.relaunch() и выход
  log(message: string): void;
  now?: () => number;
  intervalMs?: number;
  graceMs?: number;               // сколько держится превышение до перезапуска
  cooldownMs?: number;            // не чаще, чем раз в этот срок
}

export interface MemoryWatch {
  check(now?: number): void;
  start(): void;
  stop(): void;
}

export const MEMORY_NOTICE = 'Занимаю много памяти, перезапущусь';
const DEFAULT_INTERVAL_MS = 60000;
const DEFAULT_GRACE_MS = 60000;
const DEFAULT_COOLDOWN_MS = 3600000;

// Следит за памятью приложения в простое: сначала перезагружает окна, а если
// предел всё ещё превышен — один раз предупреждает и мягко перезапускается.
export function createMemoryWatch(deps: MemoryWatchDeps): MemoryWatch {
  const now = deps.now ?? ((): number => Date.now());
  const graceMs = deps.graceMs ?? DEFAULT_GRACE_MS;
  const cooldownMs = deps.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  let overSince: number | undefined;
  let notified = false;
  let lastRelaunchAt = -Infinity;
  let timer: ReturnType<typeof setInterval> | undefined;

  function check(at: number = now()): void {
    const metrics = deps.getMetrics();
    // Во время разговора ничего не перезапускается, счётчик превышения сбрасывается.
    if (!deps.isIdle()) {
      overSince = undefined;
      return;
    }
    if (metrics.appMb <= deps.getLimitMb()) {
      overSince = undefined;
      notified = false;
      return;
    }
    if (overSince === undefined) {
      overSince = at;
      deps.log(`память ${Math.round(metrics.appMb)} МБ больше предела, перезагружаю окна`);
      deps.reloadWindows();
      return;
    }
    if (at - overSince < graceMs) {
      return;
    }
    if (at - lastRelaunchAt < cooldownMs) {
      return;
    }
    if (!notified) {
      notified = true;
      deps.notify(MEMORY_NOTICE);
    }
    lastRelaunchAt = at;
    deps.relaunch();
  }

  return {
    check,
    start(): void {
      if (timer === undefined) {
        timer = setInterval(() => check(), deps.intervalMs ?? DEFAULT_INTERVAL_MS);
        timer.unref?.();
      }
    },
    stop(): void {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    }
  };
}
