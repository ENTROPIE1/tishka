export interface MemoryMetrics {
  appMb: number;    // сумма памяти процессов приложения
  sttMb: number;    // память службы распознавания
}

export interface MemoryWatchDeps {
  getMetrics(): MemoryMetrics;
  getLimitMb(): number;
  beforeCheck?(): void;           // обновить внешние измерения перед проверкой
  isIdle(): boolean;              // нет разговора и выполняющейся просьбы
  reloadWindows(): void;          // перезагрузить окно-питомец и окно чата
  notify(text: string): void;     // одно уведомление перед перезапуском
  relaunch(): void;               // app.relaunch() и выход
  canRelaunch?: boolean;          // false — режим разработки: вместо перезапуска сообщение (по умолчанию true)
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
export const MEMORY_DEV_NOTICE = 'Занимаю много памяти, перезапустите Тишку вручную';
const DEFAULT_INTERVAL_MS = 60000;
const DEFAULT_GRACE_MS = 60000;
const DEFAULT_COOLDOWN_MS = 3600000;

// Следит за памятью приложения в простое: сначала перезагружает окна, а если
// предел всё ещё превышен — один раз предупреждает и мягко перезапускается.
export function createMemoryWatch(deps: MemoryWatchDeps): MemoryWatch {
  const now = deps.now ?? ((): number => Date.now());
  const graceMs = deps.graceMs ?? DEFAULT_GRACE_MS;
  const cooldownMs = deps.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const canRelaunch = deps.canRelaunch ?? true;
  let overSince: number | undefined;
  let notified = false;
  let lastRelaunchAt = -Infinity;
  let timer: ReturnType<typeof setInterval> | undefined;

  function check(at: number = now()): void {
    deps.beforeCheck?.();
    const metrics = deps.getMetrics();
    // Во время разговора ничего не перезапускается, счётчик превышения сбрасывается.
    if (!deps.isIdle()) {
      overSince = undefined;
      return;
    }
    const limit = deps.getLimitMb();
    if (metrics.appMb + metrics.sttMb <= limit) {
      overSince = undefined;
      notified = false;
      return;
    }
    if (overSince === undefined) {
      overSince = at;
      const app = Math.round(metrics.appMb);
      const stt = Math.round(metrics.sttMb);
      deps.log(`память приложения ${app} МБ и службы распознавания ${stt} МБ больше предела ${limit} МБ`);
      // Окна перезагружаются, только если предел превысила сама память приложения.
      if (metrics.appMb > limit) {
        deps.reloadWindows();
      }
      return;
    }
    if (at - overSince < graceMs) {
      return;
    }
    if (at - lastRelaunchAt < cooldownMs) {
      return;
    }
    // В режиме разработки перезапуск теряет сервер разработки: вместо него
    // человеку уходит сообщение, а в журнал времени — отметка.
    if (!canRelaunch) {
      if (!notified) {
        notified = true;
        deps.notify(MEMORY_DEV_NOTICE);
      }
      deps.log('перезапуск по пределу памяти пропущен в режиме разработки');
      lastRelaunchAt = at;
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
