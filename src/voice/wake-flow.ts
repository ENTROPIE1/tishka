import type { Config, EventBus, TishkaEvent } from '../core/types';
import type { TimingMark } from '../main/timing-log';
import type { SttStatus, TranscribeResult } from './stt-service';
import { createWakeState } from './wake-state';
import { createWakeDecision } from './wake-decide';
import { createWakeTalk, type TalkSurface, type WakeCommand } from './wake-talk';
import { createWaitWindow, type WaitWindow } from './wake-wait';
import { createBusyIntervals, type BusyReason } from './busy-intervals';

export type { TalkSurface, WakeCommand } from './wake-talk';

export interface WakeFlowDeps {
  getVoice(): Config['voice'];
  stt: { transcribe(wav: Uint8Array, prompt?: string): Promise<TranscribeResult> };
  core: { handleUserText(text: string): Promise<unknown> };
  bus: EventBus;
  sendCommand(command: WakeCommand): void;
  hide(): void;
  onSoonChange?(): void;
  isReady?(): boolean;                 // служба распознавания готова
  getStatus?(): SttStatus;             // 'starting' — служба поднимается, не ошибка
  isVisible?(surface: TalkSurface): boolean;   // окно ещё на экране: ждать готовности есть смысл
  onWaitingChange?(): void;            // изменилось ожидание готовности службы
  memoryName?(): string | undefined;   // имя человека из памяти для подсказки
  onMissedSpeech?(): void;             // «Не расслышал» — повод для подсказки о калибровке
  onUnheard?(text: string): void;      // тихая фраза отброшена по уверенности: подпись «не разобрал»
  onUnheardHint?(): void;              // три такие фразы подряд: подсказка про порог и микрофон
  onWakeLimit?(): void;                // отрезок упёрся в предел длины при прослушивании имени
  onWakePhraseEnd?(): void;            // фраза закончилась сама: серия отрезков прервана
  onBusyPhrase?(text: string): boolean;   // Тишка занят: «стоп» останавливает работу, фраза в ядро не уходит
  mark?: TimingMark;                   // журнал времени: отброшенные фразы и их причины
}

export interface WakeFlow {
  // limitHit — отрезок упёрся в предел; startedAt — время начала фразы.
  handlePhrase(wav: Uint8Array, limitHit?: boolean, startedAt?: number): void;
  toggleConversation(by?: TalkSurface): void;
  enableConversation(by?: TalkSurface): void;
  disableConversation(hide: boolean, by?: TalkSurface): void;
  noteReady(): void;                   // служба распознавания стала готова
  noteFailed(message?: string): void;  // служба не поднялась: ошибка или тайм-аут
  isWaiting(): boolean;                // запись отложена до готовности службы
  onKeyboardInput(): void;
  escape(): void;
  isConversation(): boolean;
  conversationOwner(): TalkSurface | null;
  isLeavingSoon(): boolean;
  reportError(message: string): void;
  stop(): void;
}

const ERROR_COOLDOWN_MS = 30000;

// Причины занятости: обдумывание, работа инструмента и речь Тишки.
const BUSY_REASON: Partial<Record<TishkaEvent['type'], BusyReason>> = {
  'think.start': 'thinking',
  'tool.start': 'work',
  'speak.start': 'speech'
};
// Вопрос подтверждения — не «занят»: пока он открыт, ответ человека («да»/«нет»)
// должен дойти до ядра репликой.
const BUSY_END = new Set<TishkaEvent['type']>(['idle', 'speak.end', 'confirm.request']);

// Связка голоса с окном ежа: ведение разговора, окно ожидания службы, решение
// по фразе и правила занятости собраны в отдельных модулях, здесь — общая шина.
export function createWakeFlow(deps: WakeFlowDeps): WakeFlow {
  const state = createWakeState();
  const busy = createBusyIntervals();
  let lastErrorAt = -Infinity;

  function reportError(message: string): void {
    const now = Date.now();
    if (now - lastErrorAt < ERROR_COOLDOWN_MS) {
      return;
    }
    lastErrorAt = now;
    deps.bus.emit({ type: 'error', message });
  }

  // Ссылки заполняются сразу после создания: колбэки зовут их позже.
  let decision!: ReturnType<typeof createWakeDecision>;
  let waitWindow!: WaitWindow;

  const talk = createWakeTalk({
    getVoice: () => deps.getVoice(),
    bus: deps.bus,
    wait: () => waitWindow,
    sendCommand: (command) => deps.sendCommand(command),
    hide: () => deps.hide(),
    isBusy: () => state.busy(),
    reportError,
    onConversationEnabled: () => decision.conversationEnabled(),
    onConversationDisabled: () => decision.conversationDisabled(),
    onSoonChange: () => deps.onSoonChange?.(),
    isReady: () => deps.isReady?.()
  });

  decision = createWakeDecision({
    getVoice: () => deps.getVoice(),
    core: deps.core,
    stt: deps.stt,
    bus: deps.bus,
    talk,
    state,
    busy,
    mark: deps.mark,
    memoryName: () => deps.memoryName?.(),
    onBusyPhrase: deps.onBusyPhrase,
    onMissedSpeech: () => deps.onMissedSpeech?.(),
    onUnheard: (text) => deps.onUnheard?.(text),
    onUnheardHint: () => deps.onUnheardHint?.(),
    reportError
  });

  waitWindow = createWaitWindow({
    getVoice: () => deps.getVoice(),
    enable: (surface) => talk.enable(surface),
    isConversation: () => talk.isConversation(),
    owner: () => talk.owner(),
    isSuppressed: () => talk.suppressed(),
    isBusy: () => state.busy(),
    isReady: () => deps.isReady?.(),
    getStatus: () => deps.getStatus?.(),
    isVisible: (surface) => deps.isVisible?.(surface),
    onWaitingChange: () => deps.onWaitingChange?.(),
    reportError
  });

  // Появление ежа, речь и занятость: состояние ведёт связка, отрезки — модуль.
  const unsubscribe = deps.bus.on((event) => {
    if (event.type === 'wake') {
      talk.appear(event.source);
    }
    const reason = BUSY_REASON[event.type];
    if (reason !== undefined) {
      busy.begin(reason);
    } else if (BUSY_END.has(event.type)) {
      busy.finish();
    }
    if (event.type === 'speak.start') {
      state.transition('speak');
    } else if (event.type === 'speak.end') {
      state.transition('speech-end');
    }
  });

  return {
    // limitHit — отрезок упёрся в предел длины при прослушивании имени;
    // startedAt — время начала фразы (момент первого звука).
    handlePhrase: (wav, limitHit = false, startedAt = Date.now()) => {
      if (limitHit) {
        deps.onWakeLimit?.();
      } else {
        deps.onWakePhraseEnd?.();
      }
      decision.add(wav, startedAt);
    },
    toggleConversation: (by) => talk.toggle(by),
    enableConversation: (by) => talk.enable(by),
    disableConversation: (hide, by) => talk.disable(hide, by),
    noteReady: () => waitWindow.noteReady(),
    noteFailed: (message) => waitWindow.noteFailed(message),
    isWaiting: () => waitWindow.isWaiting(),
    onKeyboardInput: () => talk.arm(),
    escape: () => talk.disable(false),
    isConversation: () => talk.isConversation(),
    conversationOwner: () => talk.owner(),
    isLeavingSoon: () => talk.isLeavingSoon(),
    reportError,
    stop(): void {
      talk.stop();
      decision.dropPending();
      unsubscribe();
    }
  };
}
