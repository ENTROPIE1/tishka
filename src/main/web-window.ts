import { BrowserWindow, session } from 'electron';

const PARTITION = 'tishka-web-read';
const BLOCKED_RESOURCES = new Set(['image', 'media', 'font']);

let window: BrowserWindow | undefined;

function configureSession(): void {
  const ses = session.fromPartition(PARTITION);
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.on('will-download', (event) => event.preventDefault());
  ses.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: BLOCKED_RESOURCES.has(details.resourceType) });
  });
}

// Скрытое окно с временной сессией: без входов, куки и истории человека.
export function openWebWindow(): BrowserWindow {
  if (window !== undefined && !window.isDestroyed()) {
    return window;
  }
  configureSession();
  window = new BrowserWindow({
    show: false,
    width: 1024,
    height: 768,
    webPreferences: {
      partition: PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      disableDialogs: true,
      images: false
    }
  });
  window.webContents.setAudioMuted(true);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('login', (event: Electron.Event, ..._rest: unknown[]) => {
    event.preventDefault();
  });
  return window;
}

export function closeWebWindow(): void {
  if (window !== undefined && !window.isDestroyed()) {
    window.destroy();
  }
  window = undefined;
}
