import { BrowserWindow } from 'electron';
import { join } from 'node:path';

const WINDOW_WIDTH = 840;
const WINDOW_HEIGHT = 660;

let settingsWindow: BrowserWindow | undefined;

// Одно окно настроек на приложение: повторный вызов поднимает и фокусирует его.
export function openSettingsWindow(): void {
  if (settingsWindow !== undefined && !settingsWindow.isDestroyed()) {
    if (settingsWindow.isMinimized()) {
      settingsWindow.restore();
    }
    settingsWindow.focus();
    return;
  }

  const window = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    title: 'Тишка — подключения',
    backgroundColor: '#f6f6f4',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  window.setMenu(null);
  window.on('closed', () => {
    if (settingsWindow === window) {
      settingsWindow = undefined;
    }
  });

  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (rendererUrl !== undefined) {
    void window.loadURL(`${rendererUrl}/settings/index.html`);
  } else {
    void window.loadFile(join(__dirname, '../renderer/settings/index.html'));
  }

  settingsWindow = window;
}

export function closeSettingsWindow(): void {
  if (settingsWindow !== undefined && !settingsWindow.isDestroyed()) {
    settingsWindow.close();
  }
}
