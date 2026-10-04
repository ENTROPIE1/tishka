import type { Config, Reply } from '../../src/core/types';
import { defaultConfig } from '../../src/core/config';
import type { SttStatus } from '../../src/voice/stt-service';
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
  bounds(): WindowRect;           // положение окна
  spoken(): string[];             // что произнесено
  errors(): string[];             // показанные сообщения об ошибках
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
  noise(): boolean;                       // шум: пустое распознавание
  typeKey(): void;                        // печать в строке ежа
  pressPet(): void;                       // нажатие ежа мышью
  releasePet(): void;                     // отпускание ежа
  sendFromComposer(text: string): void;   // отправка текста из строки ежа
  sendFromChat(text: string): void;       // отправка текста из окна чата
  notifyFromSkill(title: string): void;   // уведомление от навыка
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
  return config;
}
