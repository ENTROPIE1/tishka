import { ipcMain } from 'electron';
import { TIMING_MARK_CHANNEL, TIMING_OPEN_CHANNEL } from './ipc-channels';
import { mark, type TimingDetails } from './timing-log';

export interface TimingIpcDeps {
  logPath: string;
  openPath: (path: string) => Promise<string>;
}

// Отметки из окон доходят до журнала, а кнопка настроек открывает сам файл.
// Детали от окна принимаются только простыми значениями.
function cleanDetails(details: unknown): TimingDetails | undefined {
  if (typeof details !== 'object' || details === null) {
    return undefined;
  }
  const clean: TimingDetails = {};
  for (const [key, value] of Object.entries(details)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      clean[key] = value;
    }
  }
  return clean;
}

export function registerTimingIpc(deps: TimingIpcDeps): void {
  ipcMain.on(TIMING_MARK_CHANNEL, (_event, event: unknown, details: unknown) => {
    if (typeof event !== 'string' || event.trim() === '') {
      return;
    }
    mark(event, cleanDetails(details));
  });

  ipcMain.handle(TIMING_OPEN_CHANNEL, () => deps.openPath(deps.logPath));
}
