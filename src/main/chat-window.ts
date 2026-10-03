import { BrowserWindow } from 'electron';
import { join } from 'node:path';

const WINDOW_WIDTH = 760;
const WINDOW_HEIGHT = 600;

let chatWindow: BrowserWindow | undefined;

// Одно окно чата на приложение: повторный вызов поднимает и фокусирует его.
export function openChatWindow(): void {
  if (chatWindow !== undefined && !chatWindow.isDestroyed()) {
    if (chatWindow.isMinimized()) {
      chatWindow.restore();
    }
    chatWindow.show();
    chatWindow.focus();
    return;
  }

  const window = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    title: 'Тишка',
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
    if (chatWindow === window) {
      chatWindow = undefined;
    }
  });

  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (rendererUrl !== undefined) {
    void window.loadURL(`${rendererUrl}/chat/index.html`);
  } else {
    void window.loadFile(join(__dirname, '../renderer/chat/index.html'));
  }

  chatWindow = window;
}
