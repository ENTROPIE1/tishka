import { app, globalShortcut, ipcMain, Menu, shell, type Tray } from 'electron';
import { join } from 'node:path';
import { createTishkaCore, type TishkaCore } from '../core/app';
import { saveConfig as persistConfig } from '../core/config';
import type { Config } from '../core/types';
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

const bus = createEventBus();
let core: TishkaCore | undefined;
let pet: PetWindow | undefined;
let tray: Tray | undefined;
let stt: SttService | undefined;
let hotkeys: HotkeyRegistrar | undefined;

// Второй запуск не создаёт копию, а поднимает окно чата работающего приложения.
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    openChatWindow();
  });
}

function voiceRestartNeeded(previous: Config, next: Config): boolean {
  const before = previous.voice;
  const after = next.voice;
  return (
    before.sttUrl !== after.sttUrl ||
    before.stt.exe !== after.stt.exe ||
    before.stt.model !== after.stt.model
  );
}

app.whenReady().then(async () => {
  if (!singleInstance) {
    return;
  }
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
  registerSettingsIpc(tishka, secrets, {
    // Голос перезапускается сам, если изменились программа, модель или адрес.
    onConfigSaved: (previous, next) => {
      if (stt !== undefined && voiceRestartNeeded(previous, next)) {
        stt.stop();
        void stt.start().catch(() => undefined);
      }
    }
  });
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

  openChatWindow();

  app.on('activate', () => {
    openChatWindow();
  });
});

// Приложение живёт в области уведомлений, пока пользователь не выйдет из меню значка.
app.on('window-all-closed', () => undefined);

// Служба распознавания останавливается при любом способе выхода.
function stopVoice(): void {
  stt?.stop();
}

app.on('before-quit', stopVoice);
process.on('SIGINT', () => {
  stopVoice();
  app.quit();
});
process.on('SIGTERM', () => {
  stopVoice();
  app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  hotkeys?.dispose();
  stt?.stop();
  pet?.dispose();
  tray?.destroy();
  void core?.stop();
});
