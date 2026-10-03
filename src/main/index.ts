import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { createEventBus } from '../core/events';
import { electronCrypto } from '../core/secrets/electron-crypto';
import { createSecretStore } from '../core/secrets/store';
import { registerIpc } from './ipc';

const bus = createEventBus();

function createWindow(): void {
  const window = new BrowserWindow({
    width: 480,
    height: 360,
    title: 'Тишка',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (rendererUrl !== undefined) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  const secrets = createSecretStore(join(app.getPath('userData'), 'secrets.bin'), electronCrypto);
  registerIpc(bus, (text) => {
    console.debug(`[tishka] user text: ${text}`);
  }, secrets);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
