import { app, globalShortcut, ipcMain, Menu, Notification, shell } from 'electron';
import { join } from 'node:path';
import { createTishkaCore, type TishkaCore } from '../core/app';
import { saveConfig as persistConfig } from '../core/config';
import type { Config } from '../core/types';
import { createEventBus } from '../core/events';
import { electronCrypto } from '../core/secrets/electron-crypto';
import { createSecretStore } from '../core/secrets/store';
import { createSttService, type SttService } from '../voice/stt-service';
import { loginItemSettings, startedHidden } from './autostart';
import { openMainWindow, reloadMainWindow } from './chat-window';
import { registerChatTalk, type ChatTalk } from './chat-talk';
import { createMemoryWatch, type MemoryWatch } from './memory-watch';
import { OPEN_CHAT_CHANNEL, PET_SPEAK_DONE_CHANNEL } from './ipc-channels';
import { registerAutomationIpc } from './ipc-automations';
import { registerIpc } from './ipc';
import { registerSettingsIpc } from './ipc-settings';
import { registerSpeechIpc } from './ipc-speech';
import { registerVoiceIpc } from './ipc-voice';
import { createHotkeyRegistrar, type HotkeyRegistrar } from './pet-hotkey';
import { registerPetIpc } from './pet-ipc';
import { createPetListen } from './pet-listen';
import { createSpeechOutput, type SpeechOutput } from './pet-speak';
import { createPetTray, type PetTray } from './pet-tray';
import { createPetWindow, type PetWindow } from './pet-window';
import { registerPetWake, type PetWake } from './pet-wake';
import { createScreenCapture } from './screen-capture';
import { openStandWindow } from './stand-window';
import { createWebReader, type WebReaderHandle } from './web-reader';
import { createWakeFlow } from '../voice/wake-flow';
import { createCalibrationHint, CALIBRATION_HINT } from '../voice/calibration-hint';

const bus = createEventBus();
let core: TishkaCore | undefined;
let pet: PetWindow | undefined;
let tray: PetTray | undefined;
let stt: SttService | undefined;
let hotkeys: HotkeyRegistrar | undefined;
let petWake: PetWake | undefined;
let speech: SpeechOutput | undefined;
let speechDone: (() => void) | undefined;
let chatTalk: ChatTalk | undefined;
let webReader: WebReaderHandle | undefined;
let memoryWatch: MemoryWatch | undefined;
let processing = false;

// Второй запуск не создаёт копию, а поднимает окно чата работающего приложения.
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    openMainWindow();
  });
}

function voiceRestartNeeded(previous: Config, next: Config): boolean {
  const before = previous.voice;
  const after = next.voice;
  return before.sttUrl !== after.sttUrl || before.stt.exe !== after.stt.exe || before.stt.model !== after.stt.model;
}

// При запуске со стендом открывается он, иначе — обычное окно чата.
function openStartupWindow(): void {
  if (process.env['TISHKA_STAND'] === '1') {
    openStandWindow();
  } else {
    openMainWindow('chat');
  }
}

app.whenReady().then(async () => {
  if (!singleInstance) {
    return;
  }
  Menu.setApplicationMenu(null);
  const dataDir = app.getPath('userData');
  const appRoot = app.isPackaged ? app.getAppPath() : join(__dirname, '..', '..');
  const secrets = createSecretStore(join(dataDir, 'secrets.bin'), electronCrypto);

  // Окно-питомец создаётся ниже, а снимок запрашивается уже после запуска,
  // поэтому замыкание обращается к pet по ссылке.
  const screenCapture = createScreenCapture({
    hidePet: async () => {
      pet?.hide();
    },
    showPet: () => {
      pet?.show();
    }
  });

  const reader = createWebReader();
  webReader = reader;

  const tishka = createTishkaCore({
    dataDir,
    presetsDir: join(appRoot, 'presets'),
    appRoot,
    secrets,
    events: bus,
    openExternal: (url) => shell.openExternal(url),
    // Панели приходят в составе ответа, отдельного показа пока не нужно.
    showPanel: () => undefined,
    now: () => new Date(),
    captureScreen: (target) => screenCapture.capture(target),
    readWeb: (url, options) => reader.read(url, options)
  });
  core = tishka;

  registerIpc(bus, tishka, secrets);
  registerAutomationIpc(tishka);
  registerSettingsIpc(tishka, secrets, {
    // Голос перезапускается сам, если изменились программа, модель или адрес.
    onConfigSaved: (previous, next) => {
      if (stt !== undefined && voiceRestartNeeded(previous, next)) {
        stt.stop();
        void stt.start().catch(() => undefined);
      }
      if (previous.app.autostart !== next.app.autostart) {
        app.setLoginItemSettings(loginItemSettings(next.app.autostart));
      }
      speech?.warm();
      petWake?.broadcast();
      chatTalk?.broadcast();
      tray?.refresh();
    }
  });
  ipcMain.handle(OPEN_CHAT_CHANNEL, () => {
    openMainWindow('chat');
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

  // Звук, отправленный в окно-питомец, считается проигранным после ответа speak-done.
  ipcMain.on(PET_SPEAK_DONE_CHANNEL, () => {
    const resolve = speechDone;
    speechDone = undefined;
    resolve?.();
  });

  const speechOutput = createSpeechOutput({
    bus,
    getConfig: () => tishka.config(),
    play: (message, signal) =>
      new Promise<void>((resolve) => {
        if (pet === undefined) {
          resolve();
          return;
        }
        speechDone = resolve;
        pet.speak(message);
        signal.addEventListener('abort', () => pet?.stopSpeaking(), { once: true });
      })
  });
  speech = speechOutput;
  registerSpeechIpc(speechOutput);
  speechOutput.warm();

  const calibrationHint = createCalibrationHint({
    isCalibrated: () => tishka.config().voice.mic.calibratedAt !== null,
    report: () => bus.emit({ type: 'status', text: CALIBRATION_HINT })
  });

  const listen = createPetListen({
    bus,
    core: tishka,
    stt: sttService,
    sendCommand: (command) => pet?.listenCommand(command),
    onMissedSpeech: () => calibrationHint.missed()
  });
  registerPetIpc(pet, listen);

  const wakeFlow = createWakeFlow({
    getVoice: () => tishka.config().voice,
    stt: sttService,
    core: tishka,
    bus,
    memoryName: () => tishka.memoryName(),
    isReady: () => sttService.status() === 'ready',
    onMissedSpeech: () => calibrationHint.missed(),
    sendCommand: (command) => {
      if (command === 'listen') {
        pet?.listenCommand('start');
      }
      petWake?.broadcast();
      chatTalk?.broadcast();
      tray?.refresh();
    },
    hide: () => pet?.leave(),
    onSoonChange: () => {
      petWake?.broadcast();
      chatTalk?.broadcast();
    }
  });
  petWake = registerPetWake({
    pet,
    flow: wakeFlow,
    bus,
    getVoice: () => tishka.config().voice,
    getWarmMinutes: () => tishka.config().app.warmMinutes,
    isReady: () => sttService.status() === 'ready'
  });

  tray = createPetTray({
    wake: () => pet?.wake('name'),
    openChat: () => openMainWindow('chat'),
    openSettings: () => openMainWindow('connections'),
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

  chatTalk = registerChatTalk({
    flow: wakeFlow,
    bus,
    getVoice: () => tishka.config().voice,
    isReady: () => sttService.status() === 'ready',
    onChange: () => {
      petWake?.broadcast();
      tray?.refresh();
    }
  });

  // Горячая клавиша включает режим разговора, повторное нажатие — выключает.
  function toggleConversationByHotkey(): void {
    if (!wakeFlow.isConversation()) {
      bus.emit({ type: 'wake', source: 'hotkey' });
    }
    wakeFlow.toggleConversation();
    petWake?.broadcast();
    chatTalk?.broadcast();
    tray?.refresh();
  }

  const hotkeyRegistrar = createHotkeyRegistrar(bus);
  hotkeys = hotkeyRegistrar;
  hotkeyRegistrar.set(tishka.config().voice.hotkey, toggleConversationByHotkey);
  registerVoiceIpc({
    stt: sttService,
    reloadHotkey: (hotkey) => hotkeyRegistrar.set(hotkey, toggleConversationByHotkey),
    setCalibration: (active) => {
      petWake?.setPaused(active);
      chatTalk?.setPaused(active);
    }
  });

  app.setLoginItemSettings(loginItemSettings(tishka.config().app.autostart));

  bus.on((event) => {
    if (event.type === 'think.start' || event.type === 'tool.start') {
      processing = true;
    } else if (event.type === 'idle' || event.type === 'speak.end') {
      processing = false;
    }
  });

  memoryWatch = createMemoryWatch({
    getMetrics: () => ({ appMb: applicationMemoryMb(), sttMb: 0 }),
    getLimitMb: () => tishka.config().app.memoryLimitMb,
    isIdle: () => !wakeFlow.isConversation() && !processing,
    reloadWindows: () => {
      pet?.reload();
      reloadMainWindow();
    },
    notify: (text) => {
      new Notification({ title: 'Тишка', body: text }).show();
    },
    relaunch: () => {
      app.relaunch();
      app.quit();
    },
    log: (message) => console.warn(`[tishka] ${message}`)
  });
  memoryWatch.start();

  // Служба распознавания поднимается в фоне, чтобы не задерживать окна.
  void sttService.start()
    .then(() => {
      petWake?.broadcast();
      chatTalk?.broadcast();
    })
    .catch(() => undefined);

  if (!startedHidden(process.argv)) {
    openStartupWindow();
  }

  app.on('activate', () => {
    openStartupWindow();
  });
});

// Сумма памяти процессов приложения без службы распознавания (в мегабайтах).
function applicationMemoryMb(): number {
  return app.getAppMetrics().reduce((sum, metric) => sum + metric.memory.workingSetSize, 0) / 1024;
}

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
  memoryWatch?.stop();
  stt?.stop();
  petWake?.dispose();
  speech?.dispose();
  chatTalk?.dispose();
  webReader?.dispose();
  pet?.dispose();
  tray?.destroy();
  void core?.stop();
});
