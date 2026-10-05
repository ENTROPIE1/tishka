import type { Config, Reply } from '../../src/core/types';
import { defaultConfig } from '../../src/core/config';
import type { SttStatus, TranscribeResult } from '../../src/voice/stt-service';
import type { PetState } from '../../src/pet/state';
import type { FakeTts, TtsMode } from './edges';
import type { WindowRect } from './window-edge';

export interface ScenarioOptions {
  sttStatus?: SttStatus;          // служба распознавания на момент запуска
  talkByDefault?: boolean;        // разговор включается при появлении
  wakeEnabled?: boolean;          // отклик на имя
  talkTimeoutSec?: number;        // уход по тишине в разговоре
  warmMinutes?: number;           // сколько держать микрофон после обращения
  tts?: TtsMode;                  // служба синтеза
  reply?: Reply;                  // ответ ядра по умолчанию
  screenEnabled?: boolean;        // разрешён ли Тишке просмотр экрана
}

export interface ScenarioObservations {
  visible(): boolean;             // виден ли ёж
  state(): PetState;              // состояние ежа
  label(): string;                // подпись состояния
  bubble(): string;               // текст облачка
  modelSay(): string | undefined; // реплика в модели (приветствие или ответ)
  card(): boolean;                // показана ли карточка
  micOn(): boolean;               // значок микрофона включён
  micWaiting(): boolean;          // значок в ожидании службы
  soon(): boolean;                // «скоро уйду»
  recording(): boolean;           // идёт ли запись
  listening(): boolean;           // индикатор записи строки (команда listen)
  interactive(): boolean;         // строка принимает щелчки
  composerVisible(): boolean;     // строка ввода видна
  composerCollapsed(): boolean;   // строка свёрнута в полочку
  sendIsStop(): boolean;          // кнопка отправки ежа показывает остановку
  eyeOn(): boolean;               // кнопка с глазом у ежа активна
  eyeHidden(): boolean;           // кнопка с глазом у ежа скрыта настройкой
  chatEyeOn(): boolean;           // кнопка с глазом в чате активна
  bounds(): WindowRect;           // положение окна
  spoken(): string[];             // что произнесено
  errors(): string[];             // показанные сообщения об ошибках
  statuses(): string[];           // события статуса (подсказки в облачке)
  commands(): string[];           // команды разговора: listen, conversation-on/off
  coreCalls(): string[];          // что дошло до ядра
  sttRequests(): number;          // что ушло на распознавание
  ttsRequests(): number;          // что ушло в службу синтеза
  conversationOn(): boolean;      // включён ли режим разговора
}

export interface Scenario {
  observations: ScenarioObservations;
  startApp(): void;                       // запуск приложения
  hotkeyCall(): void;                     // вызов клавишей
  trayCall(): void;                       // щелчок по значку
  micClick(): void;                       // щелчок по микрофону
  say(text?: string): boolean;            // произнесённая фраза, текст даёт распознавание
  hear(result: string | TranscribeResult, holdMs?: number): void;
                                          // что распознавание услышит в следующей фразе;
                                          // holdMs — сколько служба «думает» до ответа
  restartListen(): void;                  // прослушивание запускается заново при действующей паузе
  feedMic(value: number, ms: number): void;  // звук в микрофон: уровень и длительность
  noise(): boolean;                       // шум: пустое распознавание
  typeKey(): void;                        // печать в строке ежа
  pressPet(): void;                       // нажатие ежа мышью
  releasePet(): void;                     // отпускание ежа
  sendFromComposer(text: string): void;   // отправка текста из строки ежа
  sendFromChat(text: string): void;       // отправка текста из окна чата
  notifyFromSkill(title: string): void;   // уведомление от навыка
  coreWillWork(holdMs: number): void;     // ядро занято: следующий ход держится holdMs
  stopFromChat(): void;                   // остановка из окна чата: строка только в ленте чата
  pressEye(question?: string): void;      // нажатие кнопки с глазом у ежа
  pressPetSend(text?: string): void;      // кнопка отправки строки ежа: занятому Тишке — остановка
  pressPetEscape(): void;                 // Escape в строке ежа: занятому Тишке — остановка
  coreLooksAtScreen(): void;              // ядро начало просмотр экрана: событие инструмента
  voiceReady(): void;                     // служба распознавания стала готова
  voiceFailed(message?: string): void;    // служба не поднялась
  wait(ms: number): Promise<void>;        // ход времени
  flush(): Promise<void>;                 // промисы без хода времени
  tts: FakeTts;                           // управление службой синтеза
  dispose(): void;
}

export function buildConfig(options: ScenarioOptions): Config {
  const config = defaultConfig();
  config.voice.wakeEnabled = options.wakeEnabled ?? true;
  config.voice.talkByDefault = options.talkByDefault ?? true;
  config.voice.talkTimeoutSec = options.talkTimeoutSec ?? 30;
  config.voice.tts.enabled = true;
  config.app.warmMinutes = options.warmMinutes ?? 30;
  config.screen.enabled = options.screenEnabled ?? true;
  return config;
}
