import { app, globalShortcut, ipcMain, Menu, Notification, shell } from 'electron';
import { join } from 'node:path';
import { createTishkaCore, type TishkaCore } from '../core/app';
import { saveConfig as persistConfig } from '../core/config';
import type { Config } from '../core/types';
import { electronCrypto } from '../core/secrets/electron-crypto';
import { createSecretStore } from '../core/secrets/store';
import { createSttService, START_CANCELLED, type SttService } from '../voice/stt-service';
import { loginItemSettings, startedHidden } from './autostart';
import { openMainWindow, reloadMainWindow } from './chat-window';
import { registerChatTalk, type ChatTalk } from './chat-talk';
import { createMemoryWatch, type MemoryWatch } from './memory-watch';
import { createProcessMemory } from './process-memory';
import { OPEN_CHAT_CHANNEL, PET_SPEAK_DONE_CHANNEL } from './ipc-channels';
import { registerAutomationIpc } from './ipc-automations';
import { registerIpc } from './ipc';
import { registerSettingsIpc } from './ipc-settings';
import { registerSpeechIpc } from './ipc-speech';
import { registerTimingIpc } from './ipc-timing';
import { registerVoiceIpc } from './ipc-voice';
import { createHotkeyRegistrar, type HotkeyRegistrar } from './pet-hotkey';
import { registerPetIpc } from './pet-ipc';
import { createPetListen } from './pet-listen';
import { createSpeechOutput, type SpeechOutput } from './pet-speak';
import { createPetSpeakPlay, type PetSpeakPlay } from './pet-speak-play';
import { createPetTray, type PetTray } from './pet-tray';
import { createPetWindow, type PetWindow } from './pet-window';
import { registerPetWake, type PetWake } from './pet-wake';
import { createScreenCapture } from './screen-capture';
import { createSourceBus } from './source-bus';
import { openStandWindow } from './stand-window';
import { runStartup } from './startup';
import { createTimingLog, mark, setTimingLog, TIMING_LOG_NAME } from './timing-log';
import { createWebReader, type WebReaderHandle } from './web-reader';
import { createWakeFlow } from '../voice/wake-flow';
import { createCalibrationHint, CALIBRATION_HINT } from '../voice/calibration-hint';

const bus = createSourceBus();
// Журнал времени заводится до всего остального: строка-разделитель с версией
// открывает каждый запуск, отметки старта процесса пишутся сразу.
const timingLogPath = join(app.getPath('userData'), TIMING_LOG_NAME);
setTimingLog(
  createTimingLog({
    filePath: timingLogPath,
    version: app.getVersion(),
    startedAt: Date.now() - Math.round(process.uptime() * 1000)
  })
);
mark('process.start');
let core: TishkaCore | undefined;
let pet: PetWindow | undefined;
let tray: PetTray | undefined;
let stt: SttService | undefined;
let hotkeys: HotkeyRegistrar | undefined;
let petWake: PetWake | undefined;
let speech: SpeechOutput | undefined;
let speakPlay: PetSpeakPlay | undefined;
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

app.whenReady().then(async () => {
  if (!singleInstance) {
    return;
  }
  Menu.setApplicationMenu(null);
  mark('app.ready');
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
    mark,
    captureScreen: (target) => screenCapture.capture(target),
    readWeb: (url, options) => reader.read(url, options)
  });
  core = tishka;

  registerIpc(bus, tishka, secrets);
  registerTimingIpc({ logPath: timingLogPath, openPath: (path) => shell.openPath(path) });
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

  const sttService = createSttService({ getConfig: () => tishka.config().voice, mark });
  stt = sttService;

  pet = createPetWindow({
    bus,
    getConfig: () => tishka.config(),
    isReady: () => sttService.status() === 'ready',
    // Позиция пишется в файл напрямую, чтобы перетаскивание не переподключало MCP.
    savePetX: (x) => persistConfig(dataDir, { ...tishka.config(), pet: { x } }),
    // Перезагрузка окна уничтожает звук: ожидающее обещание речи завершается.
    onReload: () => speakPlay?.abort()
  });
  mark('pet.window.created');

  // Звук, отправленный в окно-питомец, считается проигранным после ответа speak-done.
  ipcMain.on(PET_SPEAK_DONE_CHANNEL, (_event, id: number | undefined) => {
    speakPlay?.done(id);
  });

  speakPlay = createPetSpeakPlay({
    speak: (message) => pet?.speak(message),
    stopSpeaking: () => pet?.stopSpeaking()
  });

  const speechOutput = createSpeechOutput({
    bus,
    getConfig: () => tishka.config(),
    isReady: () => sttService.status() === 'ready',
    play: (message, signal) => speakPlay?.play(message, signal) ?? Promise.resolve(),
    mark
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
    core: { handleUserText: (text) => bus.run('pet', () => tishka.handleUserText(text)) },
    stt: sttService,
    sendCommand: (command) => pet?.listenCommand(command),
    onMissedSpeech: () => calibrationHint.missed()
  });
  registerPetIpc(pet, listen);

  const wakeFlow = createWakeFlow({
    getVoice: () => tishka.config().voice,
    stt: sttService,
    // Реплика голосом относится к тому окну, что ведёт разговор: чат или ёж.
    core: {
      handleUserText: (text) =>
        bus.run(wakeFlow.conversationOwner() === 'chat' ? 'chat' : 'pet', () => tishka.handleUserText(text))
    },
    bus,
    memoryName: () => tishka.memoryName(),
    isReady: () => sttService.status() === 'ready',
    // Ожидание готовности имеет смысл, пока окно-питомец ещё на экране.
    isVisible: (surface) => (surface === 'pet' ? (pet?.isVisible() ?? false) : true),
    onWaitingChange: () => {
      petWake?.broadcast();
      chatTalk?.broadcast();
    },
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
  mark('hotkey.registered');
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
    if (event.type === 'think.start' || event.type === 'tool.start' || event.type === 'speak.start') {
      processing = true;
    } else if (event.type === 'idle' || event.type === 'speak.end') {
      processing = false;
    }
  });

  const sttMemory = createProcessMemory({ getPid: () => sttService.pid() });

  memoryWatch = createMemoryWatch({
    getMetrics: () => ({ appMb: applicationMemoryMb(), sttMb: sttMemory.current() }),
    getLimitMb: () => tishka.config().app.memoryLimitMb,
    beforeCheck: () => {
      void sttMemory.refresh();
    },
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
  // Отложенное включение записи ждёт её готовности; отмена не считается сбоем.
  void sttService
    .start()
    .then((result) => {
      if (result.ok) {
        wakeFlow.noteReady();
      } else if (result.error !== START_CANCELLED) {
        wakeFlow.noteFailed(result.error);
      }
      petWake?.broadcast();
      chatTalk?.broadcast();
    })
    .catch(() => {
      wakeFlow.noteFailed();
      petWake?.broadcast();
      chatTalk?.broadcast();
    });

  void runStartup({
    hidden: startedHidden(process.argv),
    stand: process.env['TISHKA_STAND'] === '1',
    hasGatewayKey: () => tishka.hasGatewayKey(),
    openStand: openStandWindow,
    openChat: openMainWindow,
    // Запуск будит ежа как обычный вызов: строка ввода, микрофон по тем же правилам.
    openPet: () => pet?.wake('click')
  });

  app.on('activate', () => {
    openMainWindow();
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
