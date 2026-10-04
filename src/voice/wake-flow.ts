import type { Config, EventBus } from '../core/types';
import type { TranscribeResult } from './stt-service';
import { DISMISS_REPLY, isDismiss, matchWake, wakePrompt } from './wake';

export type WakeCommand = 'listen' | 'conversation-on' | 'conversation-off';

// Окно, владеющее режимом разговора: микрофон слушает только оно.
export type TalkSurface = 'pet' | 'chat';

export interface WakeFlowDeps {
  getVoice(): Config['voice'];
  stt: { transcribe(wav: Uint8Array, prompt?: string): Promise<TranscribeResult> };
  core: { handleUserText(text: string): Promise<unknown> };
  bus: EventBus;
  sendCommand(command: WakeCommand): void;
  hide(): void;
  onSoonChange?(): void;
  isReady?(): boolean;                 // служба распознавания готова
  memoryName?(): string | undefined;   // имя человека из памяти для подсказки
  onMissedSpeech?(): void;             // «Не расслышал» — повод для подсказки о калибровке
}

export interface WakeFlow {
  handlePhrase(wav: Uint8Array): void;
  toggleConversation(by?: TalkSurface): void;
  enableConversation(by?: TalkSurface): void;
  disableConversation(hide: boolean, by?: TalkSurface): void;
  onKeyboardInput(): void;
  escape(): void;
  isConversation(): boolean;
  conversationOwner(): TalkSurface | null;
  isLeavingSoon(): boolean;
  reportError(message: string): void;
  stop(): void;
}

const ERROR_COOLDOWN_MS = 30000;
const DEFAULT_TIMEOUT_SEC = 30;
const SOON_MS = 5000;

export function createWakeFlow(deps: WakeFlowDeps): WakeFlow {
  let conversation = false;
  let owner: TalkSurface | null = null;
  let recognizing = false;
  let answering = false;
  let soon = false;
  let pending: Uint8Array | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let soonTimer: ReturnType<typeof setTimeout> | undefined;
  let lastErrorAt = -Infinity;
  // Человек выключил микрофон значком: до конца этого появления не слушаем.
  let suppressed = false;

  function timeoutMs(): number {
    const seconds = deps.getVoice().talkTimeoutSec;
    return Math.max(1, Number.isFinite(seconds) ? seconds : DEFAULT_TIMEOUT_SEC) * 1000;
  }

  function setSoon(value: boolean): void {
    if (soon === value) {
      return;
    }
    soon = value;
    deps.onSoonChange?.();
  }

  function clearTimer(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (soonTimer !== undefined) {
      clearTimeout(soonTimer);
      soonTimer = undefined;
    }
    setSoon(false);
  }

  // Перед уходом по тишине значок мигает: состояние «скоро уйду» приходит за 5 секунд.
  function armTimer(): void {
    if (!conversation || answering) {
      return;
    }
    clearTimer();
    const total = timeoutMs();
    soonTimer = setTimeout(() => setSoon(true), Math.max(0, total - SOON_MS));
    timer = setTimeout(() => disableConversation(true), total);
  }

  function reportError(message: string): void {
    const now = Date.now();
    if (now - lastErrorAt < ERROR_COOLDOWN_MS) {
      return;
    }
    lastErrorAt = now;
    deps.bus.emit({ type: 'error', message });
  }

  function enableConversation(by: TalkSurface = 'pet'): void {
    conversation = true;
    owner = by;
    deps.sendCommand('conversation-on');
    armTimer();
  }

  // Появление человека: сбрасывает выключенный значок и, если разговор включён
  // по умолчанию, сразу переводит в режим разговора. Уведомление не в счёт.
  function appear(source: 'name' | 'hotkey' | 'click' | 'trigger'): void {
    if (source === 'trigger') {
      return;
    }
    suppressed = false;
    if (source === 'hotkey') {
      // Горячую клавишу переключает вызывающий: это явное действие.
      return;
    }
    if (deps.getVoice().talkByDefault && (deps.isReady?.() ?? true) && owner === null) {
      enableConversation('pet');
    }
  }

  function disableConversation(hide: boolean, by?: TalkSurface): void {
    const surface = by ?? owner;
    conversation = false;
    owner = null;
    clearTimer();
    deps.sendCommand('conversation-off');
    // Скрывается только окно-питомец: уход по тишине или просьбе в чате
    // выключает разговор, но не прячет питомца.
    if (hide && surface === 'pet') {
      deps.hide();
    }
  }

  function dismiss(): void {
    deps.bus.emit({ type: 'reply', reply: { say: DISMISS_REPLY } });
    disableConversation(true);
  }

  function routeConversation(text: string): void {
    if (isDismiss(text, deps.getVoice().wakeWords)) {
      dismiss();
      return;
    }
    clearTimer();
    answering = true;
    void deps.core
      .handleUserText(text)
      .catch(() => undefined)
      .finally(() => {
        answering = false;
        armTimer();
      });
  }

  function routeWake(text: string): void {
    const match = matchWake(text, deps.getVoice().wakeWords);
    if (!match.matched) {
      return;
    }
    deps.bus.emit({ type: 'wake', source: 'name' });
    if (match.rest === '') {
      if (conversation) {
        return;
      }
      deps.bus.emit({ type: 'listen.start' });
      deps.sendCommand('listen');
      return;
    }
    if (isDismiss(match.rest, deps.getVoice().wakeWords)) {
      dismiss();
      return;
    }
    deps.bus.emit({ type: 'listen.start' });
    answering = true;
    if (!conversation) {
      enableConversation();
    }
    void deps.core
      .handleUserText(match.rest)
      .catch(() => undefined)
      .finally(() => {
        answering = false;
        armTimer();
      });
  }

  function routeText(text: string): void {
    if (conversation) {
      routeConversation(text);
    } else {
      routeWake(text);
    }
  }

  async function transcribe(wav: Uint8Array): Promise<void> {
    const result = await deps.stt.transcribe(wav, wakePrompt(deps.getVoice().wakeWords, deps.memoryName?.()));
    if (!result.ok) {
      if (result.error !== 'Не расслышал') {
        reportError(result.error);
      } else {
        deps.onMissedSpeech?.();
      }
      return;
    }
    routeText(result.text);
  }

  function handlePhrase(wav: Uint8Array): void {
    const voice = deps.getVoice();
    if (!conversation && !voice.wakeEnabled) {
      return;
    }
    if (answering) {
      return;
    }
    if (recognizing) {
      pending = wav;
      return;
    }
    clearTimer();
    recognizing = true;
    void transcribe(wav).finally(() => {
      recognizing = false;
      const next = pending;
      pending = undefined;
      if (next !== undefined) {
        handlePhrase(next);
      }
    });
  }

  const unsubscribe = deps.bus.on((event) => {
    if (event.type === 'wake') {
      appear(event.source);
    }
  });

  return {
    handlePhrase,
    isConversation: () => conversation,
    conversationOwner: () => owner,
    isLeavingSoon: () => soon,
    reportError,
    toggleConversation(by: TalkSurface = 'pet'): void {
      if (conversation && owner === by) {
        disableConversation(false);
        if (by === 'pet') {
          suppressed = true;
        }
      } else if (!(by === 'pet' && suppressed)) {
        enableConversation(by);
      }
    },
    enableConversation,
    disableConversation,
    onKeyboardInput(): void {
      armTimer();
    },
    escape(): void {
      disableConversation(false);
    },
    stop(): void {
      clearTimer();
      pending = undefined;
      unsubscribe();
    }
  };
}
