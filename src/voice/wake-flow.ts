import type { Config, EventBus } from '../core/types';
import type { SttStatus, TranscribeResult } from './stt-service';
import { NOT_READY_MESSAGE, planToggle } from './talk-toggle';
import { DISMISS_REPLY, isDismiss, matchWake, wakePrompt } from './wake';
import { createPhraseQueue, routeStaleText, type StaleTextDeps } from './stale-phrase';

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
  getStatus?(): SttStatus;             // 'starting' — служба поднимается, не ошибка
  isVisible?(surface: TalkSurface): boolean;   // окно ещё на экране: ждать готовности есть смысл
  onWaitingChange?(): void;            // изменилось ожидание готовности службы
  memoryName?(): string | undefined;   // имя человека из памяти для подсказки
  onMissedSpeech?(): void;             // «Не расслышал» — повод для подсказки о калибровке
}

export interface WakeFlow {
  handlePhrase(wav: Uint8Array): void;
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
const DEFAULT_TIMEOUT_SEC = 30;
const SOON_MS = 5000;

export function createWakeFlow(deps: WakeFlowDeps): WakeFlow {
  let conversation = false;
  let owner: TalkSurface | null = null;
  let answering = false;
  let soon = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let soonTimer: ReturnType<typeof setTimeout> | undefined;
  let lastErrorAt = -Infinity;
  // Человек выключил микрофон значком: до конца этого появления не слушаем.
  let suppressed = false;
  // Обращение пришло, но служба распознавания ещё поднимается: включим запись,
  // как только она станет готова (один раз и если окно ещё на экране).
  let waiting: TalkSurface | null = null;

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

  function clearWaiting(): void {
    if (waiting === null) {
      return;
    }
    waiting = null;
    deps.onWaitingChange?.();
  }

  // Обращение без просьбы: показать запись и слушать дальше.
  function startListen(): void {
    deps.bus.emit({ type: 'listen.start' });
    deps.sendCommand('listen');
  }

  // Включение разговора: ждущая фраза сказана при выключенном режиме и
  // отбрасывается, идущее распознавание помечается устаревшим.
  function enableConversation(by: TalkSurface = 'pet'): void {
    conversation = true;
    owner = by;
    waiting = null;
    queue.conversationEnabled();
    deps.sendCommand('conversation-on');
    armTimer();
  }

  // Включить разговор сейчас или, если служба ещё поднимается, дождаться её.
  function requestListen(by: TalkSurface): void {
    if (deps.isReady?.() ?? true) {
      enableConversation(by);
      return;
    }
    if (waiting === by) {
      return;
    }
    waiting = by;
    deps.onWaitingChange?.();
  }

  // Служба ещё поднимается: щелчок откладывает включение, а не сообщает об ошибке.
  // Если состояние неизвестно, ждём только обещанный по умолчанию разговор.
  function isStarting(): boolean {
    const status = deps.getStatus?.();
    return status !== undefined ? status === 'starting' : deps.getVoice().talkByDefault;
  }

  // Появление человека: сбрасывает выключенный значок и, если разговор включён
  // по умолчанию, сразу переводит в режим разговора. Уведомление не в счёт.
  function appear(source: 'name' | 'hotkey' | 'click' | 'trigger'): void {
    if (source === 'trigger') {
      return;
    }
    if (source === 'name' && suppressed) {
      // Реплика в том же появлении: разговор сам не включается до конца появления.
      return;
    }
    suppressed = false;
    if (source === 'hotkey') {
      // Горячую клавишу переключает вызывающий: это явное действие.
      return;
    }
    if (deps.getVoice().talkByDefault && owner === null) {
      requestListen('pet');
    }
  }

  // Выключение разговора: сказанное при включённом режиме и не распознанное
  // устаревает — в ядро оно не уйдёт.
  function disableConversation(hide: boolean, by?: TalkSurface): void {
    const surface = by ?? owner;
    conversation = false;
    owner = null;
    queue.conversationDisabled();
    clearTimer();
    deps.sendCommand('conversation-off');
    // Скрывается только окно-питомец: уход по тишине или просьбе в чате
    // выключает разговор, но не прячет питомца.
    if (hide && surface === 'pet') {
      deps.hide();
      // Появление закончилось: запрет на автоматическое включение больше не нужен.
      suppressed = false;
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
      startListen();
      return;
    }
    if (isDismiss(match.rest, deps.getVoice().wakeWords)) {
      dismiss();
      return;
    }
    startListen();
    answering = true;
    if (!conversation && !suppressed) {
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

  // Текст направляется по состоянию разговора на момент фразы: сказанное при
  // другом состоянии проверяется только на имя и репликой не становится.
  function onResult(result: TranscribeResult, stale: boolean): void {
    if (result.ok) {
      if (stale) {
        routeStaleText(staleDeps, result.text);
      } else if (conversation) {
        routeConversation(result.text);
      } else {
        routeWake(result.text);
      }
      armTimer();
      return;
    }
    // Пустой или шумовой отклик распознавания человеку не показываем:
    // запись сработала на стук клавиш, прослушивание продолжается.
    if (result.empty === true) {
      return;
    }
    if (result.error !== 'Не расслышал') {
      reportError(result.error);
    } else {
      deps.onMissedSpeech?.();
    }
    armTimer();
  }

  // Фраза распознаётся, пока включён разговор или прослушивание имени,
  // и человек в этот момент не получает ответ.
  function acceptPhrase(): boolean {
    if (answering) {
      return false;
    }
    return conversation || deps.getVoice().wakeEnabled;
  }

  function transcribe(wav: Uint8Array): Promise<TranscribeResult> {
    return deps.stt.transcribe(wav, wakePrompt(deps.getVoice().wakeWords, deps.memoryName?.()));
  }

  const staleDeps: StaleTextDeps = {
    bus: deps.bus,
    wakeWords: () => deps.getVoice().wakeWords,
    inConversation: () => conversation,
    startListen
  };

  const queue = createPhraseQueue({
    accept: acceptPhrase,
    transcribe,
    onResult
  });

  const unsubscribe = deps.bus.on((event) => {
    if (event.type === 'wake') {
      appear(event.source);
    }
  });

  return {
    handlePhrase: (wav) => queue.add(wav),
    isConversation: () => conversation,
    conversationOwner: () => owner,
    isLeavingSoon: () => soon,
    isWaiting: () => waiting !== null,
    reportError,
    // Служба стала готова: одно отложенное включение записи за появление.
    noteReady(): void {
      const surface = waiting;
      if (surface === null) {
        return;
      }
      waiting = null;
      deps.onWaitingChange?.();
      if (surface === 'pet' && suppressed) {
        return;
      }
      if (conversation || owner !== null || answering) {
        return;
      }
      if (!(deps.isVisible?.(surface) ?? true)) {
        return;
      }
      enableConversation(surface);
    },
    // Служба не поднялась: запись не включается, сообщаем один раз.
    noteFailed(message?: string): void {
      if (waiting === null) {
        return;
      }
      waiting = null;
      deps.onWaitingChange?.();
      if (deps.isReady?.() ?? true) {
        return;
      }
      reportError(message ?? 'Распознавание речи не настроено');
    },
    toggleConversation(by: TalkSurface = 'pet'): void {
      const plan = planToggle(
        {
          conversation,
          owner,
          suppressed,
          ready: deps.isReady?.() ?? true,
          starting: isStarting()
        },
        by
      );
      suppressed = plan.suppressed;
      if (plan.action === 'disable') {
        disableConversation(false);
        return;
      }
      if (waiting === by) {
        // Значок нажали, пока ждали службу: до конца появления не слушаем.
        clearWaiting();
        if (by === 'pet') {
          suppressed = true;
        }
        return;
      }
      if (plan.action === 'not-ready') {
        // Щелчок не молчит: окно узнаёт причину и остаётся выключенным.
        reportError(NOT_READY_MESSAGE);
        deps.sendCommand('conversation-off');
        return;
      }
      // Готово — включить сразу; служба поднимается — дождаться готовности.
      requestListen(by);
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
      waiting = null;
      queue.dropPending();
      unsubscribe();
    }
  };
}
