import { vi } from 'vitest';
import { createSourceBus } from '../../src/main/source-bus';
import { createPetLifecycle } from '../../src/main/pet-lifecycle';
import { createWakeFlow } from '../../src/voice/wake-flow';
import { UNHEARD_HINT } from '../../src/voice/unheard';
import { createSpeechOutput, type SpeechOutput } from '../../src/main/pet-speak';
import { createPetSpeakPlay } from '../../src/main/pet-speak-play';
import { registerPetWake, type PetWake } from '../../src/main/pet-wake';
import type { PetActivation } from '../../src/main/pet-activation';
import type { Mover } from '../../src/main/pet-motion';
import type { PetPlacement } from '../../src/main/pet-placement';
import { defaultPetX, petLayout } from '../../src/pet/layout';
import { STOPPED_TITLE } from '../../src/core/stopped';
import { nextScreenLooking } from '../../src/core/screen-look';
import { EVENT_CHANNEL } from '../../src/main/ipc-channels';
import { createFakeCore, createFakeStt, createFakeTts } from './edges';
import { createWindowEdge, WORK_AREA } from './window-edge';
import { createPetFacade } from './pet-facade';
import { buildConfig, type Scenario, type ScenarioObservations, type ScenarioOptions } from './scenario-types';
import { createPhraseListener } from '../../src/renderer/shared/phrase-listener';
import type { MicCapture } from '../../src/renderer/shared/mic-capture';
import { createStopPhrase, type StopPhrase } from '../../src/voice/stop-phrase';

// registerPetWake ставит обработчики ipcMain: в стенде каналы не используются,
// сообщения человека идут напрямую в модули.
vi.mock('electron', () => ({ ipcMain: { on: vi.fn() } }));

const MIC_RATE = 16000;
const MIC_FRAME_SAMPLES = 320;   // 20 мс при 16 000 Гц

// Микрофон стенда: кадры идут в слушатель, только когда сценарий их подаёт.
function fakeMic(): MicCapture & { feed(value: number, ms: number): void } {
  let handler: ((frame: Float32Array, rate: number) => void) | undefined;
  return {
    async start(onFrame): Promise<boolean> {
      handler = onFrame;
      return true;
    },
    stop(): void {
      handler = undefined;
    },
    feed(value, ms): void {
      const frame = new Float32Array(MIC_FRAME_SAMPLES).fill(value);
      for (let left = Math.round(ms / 20); left > 0; left -= 1) {
        handler?.(frame, MIC_RATE);
      }
    }
  };
}

// Стенд сценариев: настоящие модель состояний, жизненный цикл окна, разговор
// и речь на общей шине. Подставные только края: окно, службы, ядро, часы.
export function createScenario(options: ScenarioOptions = {}): Scenario {
  vi.useFakeTimers();
  const config = buildConfig(options);
  const bus = createSourceBus();
  const commands: string[] = [];
  const spoken: string[] = [];
  const errors: string[] = [];
  const statuses: string[] = [];
  bus.on((event) => {
    if (event.type === 'speak.start') {
      spoken.push(event.text);
    } else if (event.type === 'error') {
      errors.push(event.message);
    } else if (event.type === 'status') {
      statuses.push(event.text);
    }
  });

  const stt = createFakeStt(options.sttStatus ?? 'off');
  const tts = createFakeTts(options.tts ?? 'ok');
  const core = createFakeCore(bus, options.reply ?? { say: 'Готово' });
  const isReady = (): boolean => stt.status() === 'ready';
  // Кнопка с глазом в чате: вид от событий ядра, как в chat.ts и у ежа.
  let chatLooking = false;
  bus.on((event) => {
    chatLooking = nextScreenLooking(chatLooking, event);
  });

  let petWake: PetWake | undefined;
  // Ссылки на модули, которые создаются позже окна: фраза и конец звука.
  let recognize: (wav: Uint8Array) => void = () => undefined;
  let speakDone: (id: number | undefined) => void = () => undefined;
  // Пауза страницы управляет настоящим слушателем фраз, как в окне ежа.
  let pauseListener: (paused: boolean) => void = () => undefined;
  const win = createWindowEdge({
    onPhrase: (wav) => recognize(wav),
    onSpeakDone: (id) => speakDone(id),
    onScreenLookSend: (text) => {
      void bus.run('pet', () => core.handleUserText(text)).catch(() => undefined);
    },
    onScreenLookStop: () => core.cancel(),
    onComposerSend: (text) => {
      void bus.run('pet', () => core.handleUserText(text)).catch(() => undefined);
    },
    onComposerStop: () => core.cancel(),
    screenLookAvailable: () => config.screen.enabled,
    onListenPause: (value) => pauseListener(value)
  });
  const { page } = win;
  // События ядра приходят во все окна, как broadcastEvent в ipc.ts.
  bus.on((event) => {
    win.browserWindow.webContents.send(EVENT_CHANNEL, event);
  });

  const layout = petLayout(WORK_AREA, defaultPetX(WORK_AREA), {});
  // Окно создаётся сразу на месте из раскладки, как в createPetWindow.
  win.browserWindow.setBounds(layout.window);
  const activation: PetActivation = {
    focus: () => page.focusComposer(),
    focusInput: () => page.focusComposer(),
    sendPointer: () => page.pointer()
  };
  const lifecycle = createPetLifecycle({
    window: win.browserWindow,
    mover: { stop: () => undefined } as unknown as Mover,
    placement: {
      layout,
      bounds: () => layout.window,
      ensureOnScreen: () => undefined
    } as unknown as PetPlacement,
    activation,
    bus,
    getConfig: () => config,
    isReady
  });

  const pet = createPetFacade({ bus, lifecycle, win, layout, activation });

  // Слова остановки голосом, как в main/index.ts: занятому Тишке «стоп»
  // останавливает работу и речь, в ядро не уходит.
  let speechOutput: SpeechOutput | undefined;
  const stopPhrase: StopPhrase = createStopPhrase({
    bus,
    wakeWords: () => config.voice.wakeWords,
    cancel: () => core.cancel(),
    stopSpeech: () => speechOutput?.stopSpeaking(),
    caption: (text) => pet.caption(text)
  });

  const flow = createWakeFlow({
    getVoice: () => config.voice,
    stt: { transcribe: (wav, prompt) => stt.transcribe(wav, prompt) },
    core: { handleUserText: (text) => core.handleUserText(text) },
    bus,
    sendCommand: (command) => {
      commands.push(command);
      if (command === 'listen') {
        pet.listenCommand('start');
      }
      petWake?.broadcast();
    },
    hide: () => pet.leave(),
    isReady,
    getStatus: () => stt.status(),
    isVisible: (surface) => (surface === 'pet' ? pet.isVisible() : true),
    onWaitingChange: () => petWake?.broadcast(),
    onSoonChange: () => petWake?.broadcast(),
    onUnheard: (text) => pet.caption(text),
    onUnheardHint: () => bus.emit({ type: 'status', text: UNHEARD_HINT }),
    onBusyPhrase: (text) => stopPhrase.phrase(text)
  });
  recognize = (wav) => flow.handlePhrase(wav);

  // Звуковая дорожка окна-питомца: настоящий слушатель фраз с отрезками
  // прослушивания имени, микрофон подставной — звук подаёт feedMic.
  const mic = fakeMic();
  const audio = createPhraseListener({
    threshold: config.voice.mic.threshold ?? undefined,
    chunkMs: 4000,
    chunkOverlapMs: 500,
    inConversation: () => flow.isConversation(),
    capture: mic,
    onPhrase: (wav, limitHit) => flow.handlePhrase(wav, limitHit)
  });
  pauseListener = (value) => audio.pause(value);
  void audio.start();

  const speakPlay = createPetSpeakPlay({
    speak: (message) => pet.speak(message),
    stopSpeaking: () => pet.stopSpeaking()
  });
  speakDone = (id) => speakPlay.done(id);
  const speech = createSpeechOutput({
    bus,
    getConfig: () => config,
    isReady,
    play: (message, signal) => speakPlay.play(message, signal),
    fetch: tts.fetch
  });
  speechOutput = speech;

  petWake = registerPetWake({
    pet,
    flow,
    bus,
    getVoice: () => config.voice,
    getWarmMinutes: () => config.app.warmMinutes,
    isReady
  });

  const observations: ScenarioObservations = {
    // Видимое человеком берётся со страницы окна, остальное — с модулей и краёв.
    ...page.observations,
    visible: () => lifecycle.isVisible(),
    bounds: () => win.bounds(),
    spoken: () => spoken,
    errors: () => errors,
    statuses: () => statuses,
    commands: () => commands,
    coreCalls: () => core.calls(),
    sttRequests: () => stt.requests(),
    ttsRequests: () => tts.requests(),
    conversationOn: () => flow.isConversation(),
    chatEyeOn: () => chatLooking,
    // Кнопка отправки строки ежа: занятому Тишке она показывает остановку.
    sendIsStop: () => page.observations.sendIsStop()
  };

  return {
    observations,
    tts,
    startApp(): void {
      pet.wake('click');
      petWake?.broadcast();
    },
    hotkeyCall(): void {
      bus.emit({ type: 'wake', source: 'hotkey' });
      flow.toggleConversation();
      petWake?.broadcast();
    },
    trayCall: () => pet.wake('name'),
    micClick(): void {
      flow.toggleConversation('pet');
      petWake?.broadcast();
    },
    say(text?: string): boolean {
      if (text !== undefined) {
        stt.willHear(text);
      }
      return page.say();
    },
    hear(text: string, holdMs?: number): void {
      stt.willHear(text, holdMs);
    },
    // Прослушивание запускается заново, пока действует пауза: та же связка,
    // что в окне ежа при смене состояния значка.
    restartListen(): void {
      audio.stop();
      if (page.listenPaused()) {
        audio.pause(true);
      }
      void audio.start();
    },
    feedMic(value: number, ms: number): void {
      mic.feed(value, ms);
    },
    noise: () => page.say(),
    typeKey: () => page.typeKey(),
    pressPet: () => page.press(),
    releasePet: () => page.release(),
    sendFromComposer: (text: string): void => {
      void bus.run('pet', () => core.handleUserText(text)).catch(() => undefined);
    },
    sendFromChat: (text: string): void => {
      void bus.run('chat', () => core.handleUserText(text)).catch(() => undefined);
    },
    notifyFromSkill: (title: string): void => bus.emit({ type: 'notify', title }),
    // Ядро занято: следующий ход держится holdMs, затем отвечает как обычно.
    coreWillWork(holdMs: number): void {
      core.willReply({ say: 'Работаю' }, holdMs);
    },
    // Ядро сообщает об остановке из окна чата событием статуса, а не уведомлением:
    // строка видна в ленте чата, скрытого ежа не поднимает.
    stopFromChat(): void {
      bus.emit({ type: 'status', text: STOPPED_TITLE });
      bus.emit({ type: 'idle' });
    },
    pressEye(question?: string): void {
      page.pressEye(question);
    },
    // Кнопка отправки строки ежа: занятому Тишке останавливает, иначе отправляет.
    pressPetSend(text?: string): void {
      page.pressSend(text);
    },
    // Escape в строке ежа: занятому Тишке останавливает работу.
    pressPetEscape(): void {
      page.pressEscape();
    },
    // Ядро начало просмотр экрана: событие инструмента видят кнопки в обоих окнах.
    coreLooksAtScreen(): void {
      bus.emit({ type: 'tool.start', tool: 'screen_look' });
    },
    voiceReady(): void {
      stt.setStatus('ready');
      flow.noteReady();
      petWake?.broadcast();
    },
    voiceFailed(message?: string): void {
      stt.setStatus('error');
      flow.noteFailed(message);
      petWake?.broadcast();
    },
    wait: async (ms: number): Promise<void> => {
      await vi.advanceTimersByTimeAsync(ms);
    },
    flush: async (): Promise<void> => {
      for (let step = 0; step < 6; step += 1) {
        await vi.advanceTimersByTimeAsync(0);
      }
    },
    dispose(): void {
      audio.stop();
      petWake?.dispose();
      speech.dispose();
      stopPhrase.dispose();
      flow.stop();
      pet.dispose();
    }
  };
}

export type { Scenario };
