import { describe, expect, it, vi } from 'vitest';

const onHandlers = new Map<string, (...args: unknown[]) => unknown>();
const handleHandlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    on: (channel: string, fn: (...args: unknown[]) => unknown) => void onHandlers.set(channel, fn),
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => void handleHandlers.set(channel, fn)
  }
}));

import { registerTimingIpc } from '../src/main/ipc-timing';
import { setTimingLog, type TimingLog } from '../src/main/timing-log';
import { TIMING_MARK_CHANNEL, TIMING_OPEN_CHANNEL } from '../src/main/ipc-channels';

function fakeLog(): TimingLog & { calls: Array<[string, unknown]> } {
  const calls: Array<[string, unknown]> = [];
  return {
    filePath: 'C:/data/timing.log',
    calls,
    mark: (event, details) => {
      calls.push([event, details]);
    }
  };
}

describe('registerTimingIpc', () => {
  it('отметка из окна доходит до журнала', () => {
    const log = fakeLog();
    setTimingLog(log);
    registerTimingIpc({ logPath: log.filePath, openPath: vi.fn() });
    const handler = onHandlers.get(TIMING_MARK_CHANNEL);
    expect(handler).toBeDefined();
    handler?.({}, 'mic.granted', { ms: 12 });
    expect(log.calls).toEqual([['mic.granted', { ms: 12 }]]);
  });

  it('пустое имя события игнорируется', () => {
    const log = fakeLog();
    setTimingLog(log);
    registerTimingIpc({ logPath: log.filePath, openPath: vi.fn() });
    onHandlers.get(TIMING_MARK_CHANNEL)?.({}, '  ', {});
    expect(log.calls).toEqual([]);
  });

  it('чужие типы в деталях отбрасываются', () => {
    const log = fakeLog();
    setTimingLog(log);
    registerTimingIpc({ logPath: log.filePath, openPath: vi.fn() });
    onHandlers.get(TIMING_MARK_CHANNEL)?.({}, 'reply.shown', { ok: true, nested: { a: 1 } });
    expect(log.calls).toEqual([['reply.shown', { ok: true }]]);
  });

  it('кнопка открывает файл журнала', async () => {
    const openPath = vi.fn(async () => '');
    registerTimingIpc({ logPath: 'C:/data/timing.log', openPath });
    await handleHandlers.get(TIMING_OPEN_CHANNEL)?.({});
    expect(openPath).toHaveBeenCalledWith('C:/data/timing.log');
  });
});
