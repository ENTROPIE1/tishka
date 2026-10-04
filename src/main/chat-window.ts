import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import { NAVIGATE_CHANNEL } from './ipc-channels';
import { guardNavigation } from './navigation-guard';

const WINDOW_WIDTH = 900;
const WINDOW_HEIGHT = 640;

export type MainScreen = 'chat' | 'connections' | 'memory' | 'voice' | 'persona' | 'automations';

let mainWindow: BrowserWindow | undefined;

// Отличает окно чата от окна-питомца: по отправителю реплики определяется источник.
export function isMainWindow(window: BrowserWindow): boolean {
  return window === mainWindow;
}

function raise(window: BrowserWindow): void {
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.focus();
}

// Экран можно показать только после загрузки страницы, иначе сообщение теряется.
function navigate(window: BrowserWindow, screen: MainScreen): void {
  if (window.webContents.isLoading()) {
    window.webContents.once('did-finish-load', () => {
      window.webContents.send(NAVIGATE_CHANNEL, screen);
    });
    return;
  }
  window.webContents.send(NAVIGATE_CHANNEL, screen);
}

// Одно основное окно на приложение. Без имени экрана окно только поднимается,
// с именем — ещё и переключается на нужный экран.
export function openMainWindow(screen?: MainScreen): void {
  if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
    raise(mainWindow);
    if (screen !== undefined) {
      navigate(mainWindow, screen);
    }
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
  guardNavigation(window);

  // Микрофон для диктовки: разрешён только доступ к медиа.
  window.webContents.session.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === 'media');
  });
  window.webContents.session.setPermissionCheckHandler((_contents, permission) => permission === 'media');

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = undefined;
    }
  });

  // Новое окно ещё не загружено: экран отправляется после загрузки страницы.
  if (screen !== undefined) {
    window.webContents.once('did-finish-load', () => {
      window.webContents.send(NAVIGATE_CHANNEL, screen);
    });
  }

  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (rendererUrl !== undefined) {
    void window.loadURL(`${rendererUrl}/chat/index.html`);
  } else {
    void window.loadFile(join(__dirname, '../renderer/chat/index.html'));
  }

  mainWindow = window;
}

// Перезагрузка окна чата: история и настройки хранятся на диске и вернутся сами.
export function reloadMainWindow(): void {
  if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
    mainWindow.webContents.reload();
  }
}
