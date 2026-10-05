import { vi } from 'vitest';
import { createSourceBus } from '../../src/main/source-bus';
import { createPetLifecycle } from '../../src/main/pet-lifecycle';
import { createWakeFlow } from '../../src/voice/wake-flow';
import { createSpeechOutput } from '../../src/main/pet-speak';
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
  bus.on((event) => {
    if (event.type === 'speak.start') {
      spoken.push(event.text);
    } else if (event.type === 'error') {
      errors.push(event.message);
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
  const win = createWindowEdge({
    onPhrase: (wav) => recognize(wav),
    onSpeakDone: (id) => speakDone(id),
    onScreenLookSend: (text) => {
      void bus.run('pet', () => core.handleUserText(text)).catch(() => undefined);
    },
    onScreenLookStop: () => core.cancel(),
    screenLookAvailable: () => config.screen.enabled
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
    onSoonChange: () => petWake?.broadcast()
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
    commands: () => commands,
    coreCalls: () => core.calls(),
    sttRequests: () => stt.requests(),
    ttsRequests: () => tts.requests(),
    conversationOn: () => flow.isConversation(),
    chatEyeOn: () => chatLooking
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
    hear(text: string): void {
      stt.willHear(text);
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
    // Ядро сообщает об остановке из окна чата событием статуса, а не уведомлением:
    // строка видна в ленте чата, скрытого ежа не поднимает.
    stopFromChat(): void {
      bus.emit({ type: 'status', text: STOPPED_TITLE });
      bus.emit({ type: 'idle' });
    },
    pressEye(question?: string): void {
      page.pressEye(question);
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
      flow.stop();
      pet.dispose();
    }
  };
}

export type { Scenario };
