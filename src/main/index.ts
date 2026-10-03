import { app, BrowserWindow, Menu, shell } from 'electron';
import { join } from 'node:path';
import { createTishkaCore, type TishkaCore } from '../core/app';
import { createEventBus } from '../core/events';
import { electronCrypto } from '../core/secrets/electron-crypto';
import { createSecretStore } from '../core/secrets/store';
import { registerIpc } from './ipc';
import { registerSettingsIpc } from './ipc-settings';

const bus = createEventBus();
let core: TishkaCore | undefined;

function createWindow(): void {
  const window = new BrowserWindow({
    width: 760,
    height: 600,
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
  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (rendererUrl !== undefined) {
    void window.loadURL(`${rendererUrl}/chat/index.html`);
  } else {
    void window.loadFile(join(__dirname, '../renderer/chat/index.html'));
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  const dataDir = app.getPath('userData');
  const appRoot = app.isPackaged ? app.getAppPath() : join(__dirname, '..', '..');
  const secrets = createSecretStore(join(dataDir, 'secrets.bin'), electronCrypto);

  core = createTishkaCore({
    dataDir,
    presetsDir: join(appRoot, 'presets'),
    appRoot,
    secrets,
    events: bus,
    openExternal: (url) => shell.openExternal(url),
    // Панели приходят в составе ответа, отдельного показа пока не нужно.
    showPanel: () => undefined,
    now: () => new Date()
  });

  registerIpc(bus, core, secrets);
  registerSettingsIpc(core, secrets);

  core.start().catch((error: unknown) => {
    console.error('[tishka] не удалось запустить ядро:', error instanceof Error ? error.message : error);
  });

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

app.on('will-quit', () => {
  void core?.stop();
});
