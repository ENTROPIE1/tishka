import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import { guardNavigation } from './navigation-guard';

const WINDOW_WIDTH = 900;
const WINDOW_HEIGHT = 640;

let standWindow: BrowserWindow | undefined;

// Одно окно стенда на приложение: повторный вызов поднимает и фокусирует его.
export function openStandWindow(): void {
  if (standWindow !== undefined && !standWindow.isDestroyed()) {
    if (standWindow.isMinimized()) {
      standWindow.restore();
    }
    standWindow.show();
    standWindow.focus();
    return;
  }

  const window = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    title: 'Тишка — стенд персонажа',
    backgroundColor: '#f6f6f4',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  window.setMenu(null);
  guardNavigation(window);
  window.on('closed', () => {
    if (standWindow === window) {
      standWindow = undefined;
    }
  });

  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (rendererUrl !== undefined) {
    void window.loadURL(`${rendererUrl}/stand/index.html`);
  } else {
    void window.loadFile(join(__dirname, '../renderer/stand/index.html'));
  }

  standWindow = window;
}
