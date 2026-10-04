import { app, globalShortcut, ipcMain, Menu, shell, type Tray } from 'electron';
import { join } from 'node:path';
import { createTishkaCore, type TishkaCore } from '../core/app';
import { saveConfig as persistConfig } from '../core/config';
import { createEventBus } from '../core/events';
import { electronCrypto } from '../core/secrets/electron-crypto';
import { createSecretStore } from '../core/secrets/store';
import { createSttService, type SttService } from '../voice/stt-service';
import { openChatWindow } from './chat-window';
import { OPEN_CHAT_CHANNEL } from './ipc-channels';
import { registerIpc } from './ipc';
import { registerSettingsIpc } from './ipc-settings';
import { registerVoiceIpc } from './ipc-voice';
import { createHotkeyRegistrar, type HotkeyRegistrar } from './pet-hotkey';
import { registerPetIpc } from './pet-ipc';
import { createPetListen } from './pet-listen';
import { createPetTray } from './pet-tray';
import { createPetWindow, type PetWindow } from './pet-window';
import { closeSettingsWindow, openSettingsWindow } from './settings-window';
import { openStandWindow } from './stand-window';

const bus = createEventBus();
let core: TishkaCore | undefined;
let pet: PetWindow | undefined;
let tray: Tray | undefined;
let stt: SttService | undefined;
let hotkeys: HotkeyRegistrar | undefined;

// При запуске со стендом открывается он, иначе — обычное окно чата.
function openStartupWindow(): void {
  if (process.env['TISHKA_STAND'] === '1') {
    openStandWindow();
  } else {
    openChatWindow();
  }
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const dataDir = app.getPath('userData');
  const appRoot = app.isPackaged ? app.getAppPath() : join(__dirname, '..', '..');
  const secrets = createSecretStore(join(dataDir, 'secrets.bin'), electronCrypto);

  const tishka = createTishkaCore({
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
  core = tishka;

  registerIpc(bus, tishka, secrets);
  registerSettingsIpc(tishka, secrets);
  ipcMain.handle(OPEN_CHAT_CHANNEL, () => {
    closeSettingsWindow();
    openChatWindow();
  });

  try {
    await tishka.start();
  } catch (error: unknown) {
    console.error('[tishka] не удалось запустить ядро:', error instanceof Error ? error.message : error);
  }

  const sttService = createSttService({ getConfig: () => tishka.config().voice });
  stt = sttService;

  pet = createPetWindow({
    bus,
    getConfig: () => tishka.config(),
    // Позиция пишется в файл напрямую, чтобы перетаскивание не переподключало MCP.
    savePetX: (x) => persistConfig(dataDir, { ...tishka.config(), pet: { x } })
  });

  const listen = createPetListen({
    bus,
    core: tishka,
    stt: sttService,
    sendCommand: (command) => pet?.listenCommand(command)
  });
  registerPetIpc(pet, listen);

  tray = createPetTray({
    wake: () => pet?.wake('name'),
    openChat: openChatWindow,
    openSettings: openSettingsWindow,
    openStand: openStandWindow,
    getPetMode: () => tishka.config().petMode,
    setPetMode: (value) => {
      void tishka.saveConfig({ ...tishka.config(), petMode: value });
    },
    quit: () => app.quit()
  });

  const hotkeyRegistrar = createHotkeyRegistrar(bus);
  hotkeys = hotkeyRegistrar;
  hotkeyRegistrar.set(tishka.config().voice.hotkey, () => listen.toggle('hotkey'));
  registerVoiceIpc({
    stt: sttService,
    reloadHotkey: (hotkey) => hotkeyRegistrar.set(hotkey, () => listen.toggle('hotkey'))
  });

  // Служба распознавания поднимается в фоне, чтобы не задерживать окна.
  void sttService.start().catch(() => undefined);

  openStartupWindow();

  app.on('activate', () => {
    openStartupWindow();
  });
});

// Приложение живёт в области уведомлений, пока пользователь не выйдет из меню значка.
app.on('window-all-closed', () => undefined);

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  hotkeys?.dispose();
  stt?.stop();
  pet?.dispose();
  tray?.destroy();
  void core?.stop();
});
