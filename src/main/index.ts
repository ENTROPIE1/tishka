import { app, globalShortcut, ipcMain, Menu, shell } from 'electron';
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
import { createPetTray, type PetTray } from './pet-tray';
import { createPetWindow, type PetWindow } from './pet-window';
import { registerPetWake, type PetWake } from './pet-wake';
import { closeSettingsWindow, openSettingsWindow } from './settings-window';
import { openStandWindow } from './stand-window';
import { createWakeFlow } from '../voice/wake-flow';

const bus = createEventBus();
let core: TishkaCore | undefined;
let pet: PetWindow | undefined;
let tray: PetTray | undefined;
let stt: SttService | undefined;
let hotkeys: HotkeyRegistrar | undefined;
let petWake: PetWake | undefined;

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
  return before.sttUrl !== after.sttUrl || before.stt.exe !== after.stt.exe || before.stt.model !== after.stt.model;
}

// При запуске со стендом открывается он, иначе — обычное окно чата.
function openStartupWindow(): void {
  (process.env['TISHKA_STAND'] === '1' ? openStandWindow : openChatWindow)();
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
      petWake?.broadcast();
      tray?.refresh();
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

  const wakeFlow = createWakeFlow({
    getVoice: () => tishka.config().voice,
    stt: sttService,
    core: tishka,
    bus,
    sendCommand: (command) => {
      if (command === 'listen') {
        pet?.listenCommand('start');
      }
      petWake?.broadcast();
      tray?.refresh();
    },
    hide: () => pet?.hide(),
    onSoonChange: () => petWake?.broadcast()
  });
  petWake = registerPetWake({
    pet,
    flow: wakeFlow,
    bus,
    getVoice: () => tishka.config().voice,
    isReady: () => sttService.status() === 'ready'
  });

  tray = createPetTray({
    wake: () => pet?.wake('name'),
    openChat: openChatWindow,
    openSettings: openSettingsWindow,
    openStand: openStandWindow,
    getPetMode: () => tishka.config().petMode,
    setPetMode: (value) => {
      void tishka.saveConfig({ ...tishka.config(), petMode: value });
    },
    getWakeEnabled: () => tishka.config().voice.wakeEnabled,
    setWakeEnabled: (value) => {
      void tishka.saveConfig({
        ...tishka.config(),
        voice: { ...tishka.config().voice, wakeEnabled: value }
      });
    },
    isWakeListening: () => petWake?.isListening() ?? false,
    quit: () => app.quit()
  });

  // Горячая клавиша включает режим разговора, повторное нажатие — выключает.
  function toggleConversationByHotkey(): void {
    if (!wakeFlow.isConversation()) {
      bus.emit({ type: 'wake', source: 'hotkey' });
    }
    wakeFlow.toggleConversation();
    petWake?.broadcast();
    tray?.refresh();
  }

  const hotkeyRegistrar = createHotkeyRegistrar(bus);
  hotkeys = hotkeyRegistrar;
  hotkeyRegistrar.set(tishka.config().voice.hotkey, toggleConversationByHotkey);
  registerVoiceIpc({
    stt: sttService,
    reloadHotkey: (hotkey) => hotkeyRegistrar.set(hotkey, toggleConversationByHotkey)
  });

  // Служба распознавания поднимается в фоне, чтобы не задерживать окна.
  void sttService.start().then(() => petWake?.broadcast()).catch(() => undefined);

  openStartupWindow();

  app.on('activate', () => {
    openStartupWindow();
  });
});

// Приложение живёт в области уведомлений, пока пользователь не выйдет из меню значка.
app.on('window-all-closed', () => undefined);

function stopVoice(): void {
  stt?.stop();
}

app.on('before-quit', stopVoice);
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopVoice();
    app.quit();
  });
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  hotkeys?.dispose();
  stt?.stop();
  petWake?.dispose();
  pet?.dispose();
  tray?.destroy();
  void core?.stop();
});
