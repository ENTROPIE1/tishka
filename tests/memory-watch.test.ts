import { describe, expect, it, vi } from 'vitest';
import { createMemoryWatch, MEMORY_DEV_NOTICE, MEMORY_NOTICE, type MemoryWatchDeps } from '../src/main/memory-watch';

function setup(overrides: Partial<MemoryWatchDeps> = {}): {
  deps: MemoryWatchDeps;
  watch: ReturnType<typeof createMemoryWatch>;
} {
  const deps: MemoryWatchDeps = {
    getMetrics: () => ({ appMb: 2000, sttMb: 100 }),
    getLimitMb: () => 1500,
    isIdle: () => true,
    reloadWindows: vi.fn(),
    notify: vi.fn(),
    relaunch: vi.fn(),
    log: vi.fn(),
    graceMs: 60000,
    cooldownMs: 3600000,
    ...overrides
  };
  return { deps, watch: createMemoryWatch(deps) };
}

describe('createMemoryWatch', () => {
  it('превышение в простое перезагружает окна и записывает в журнал', () => {
    const { deps, watch } = setup();

    watch.check(0);

    expect(deps.reloadWindows).toHaveBeenCalledTimes(1);
    expect(deps.log).toHaveBeenCalledTimes(1);
    expect(deps.notify).not.toHaveBeenCalled();
    expect(deps.relaunch).not.toHaveBeenCalled();
  });

  it('если через минуту предел всё ещё превышен — уведомление и перезапуск', () => {
    const { deps, watch } = setup();
    watch.check(0);
    watch.check(59999);
    expect(deps.relaunch).not.toHaveBeenCalled();

    watch.check(60000);
    expect(deps.notify).toHaveBeenCalledWith(MEMORY_NOTICE);
    expect(deps.relaunch).toHaveBeenCalledTimes(1);
  });

  it('повторное превышение в течение часа не перезапускает снова', () => {
    let mb = 2000;
    const { deps, watch } = setup({ getMetrics: () => ({ appMb: mb, sttMb: 0 }) });
    watch.check(0);
    watch.check(60000);
    expect(deps.relaunch).toHaveBeenCalledTimes(1);

    mb = 1000;
    watch.check(120000);
    mb = 2000;
    watch.check(180000);
    watch.check(240000);

    expect(deps.relaunch).toHaveBeenCalledTimes(1);
    expect(deps.notify).toHaveBeenCalledTimes(1);
  });

  it('во время разговора ничего не перезапускается', () => {
    const { deps, watch } = setup({ isIdle: () => false });
    watch.check(0);
    watch.check(600000);

    expect(deps.reloadWindows).not.toHaveBeenCalled();
    expect(deps.relaunch).not.toHaveBeenCalled();
  });

  it('приложение 900 и служба 700 при пределе 1500 — срабатывает без перезагрузки окон', () => {
    const { deps, watch } = setup({ getMetrics: () => ({ appMb: 900, sttMb: 700 }) });

    watch.check(0);
    expect(deps.reloadWindows).not.toHaveBeenCalled();

    watch.check(60000);
    expect(deps.notify).toHaveBeenCalledWith(MEMORY_NOTICE);
    expect(deps.relaunch).toHaveBeenCalledTimes(1);
  });

  it('приложение 900 без службы — предел не превышен', () => {
    const { deps, watch } = setup({ getMetrics: () => ({ appMb: 900, sttMb: 0 }) });

    watch.check(0);
    watch.check(600000);

    expect(deps.reloadWindows).not.toHaveBeenCalled();
    expect(deps.notify).not.toHaveBeenCalled();
    expect(deps.relaunch).not.toHaveBeenCalled();
  });

  it('режим разработки: вместо перезапуска сообщение человеку и запись в журнал', () => {
    const { deps, watch } = setup({ canRelaunch: false });

    watch.check(0);
    watch.check(60000);

    expect(deps.relaunch).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalledWith(MEMORY_DEV_NOTICE);
    expect(deps.log).toHaveBeenCalledWith('перезапуск по пределу памяти пропущен в режиме разработки');
  });

  it('нормальная память сбрасывает счётчик', () => {
    let mb = 2000;
    const { deps, watch } = setup({ getMetrics: () => ({ appMb: mb, sttMb: 0 }) });
    watch.check(0);
    mb = 1000;
    watch.check(30000);
    mb = 2000;
    watch.check(40000);

    // После сброса превышение снова первое: только перезагрузка окон.
    expect(deps.reloadWindows).toHaveBeenCalledTimes(2);
    expect(deps.relaunch).not.toHaveBeenCalled();
  });
});
