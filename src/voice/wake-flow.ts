import type { Config, EventBus } from '../core/types';
import type { TimingMark } from '../main/timing-log';
import type { SttStatus, TranscribeResult } from './stt-service';
import { NOT_READY_MESSAGE, planToggle } from './talk-toggle';
import { DISMISS_REPLY, SUMMON_REPLY, isDismiss, isSummonOnly, matchWake, stripSummon, wakePrompt } from './wake';
import { createPhraseClock } from './phrase-time';
import { createPhraseQueue, routeStaleText, type StaleTextDeps } from './stale-phrase';
import { createSilenceTimer } from './silence-timer';
import { createUnheardFlow } from './unheard';
import { isMissedSpeech } from './missed-speech';

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
const DEFAULT_TIMEOUT_SEC = 30;

export function createWakeFlow(deps: WakeFlowDeps): WakeFlow {
  let conversation = false;
  let owner: TalkSurface | null = null;
  let answering = false;
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

  // Тишина разговора: на время распознавания фразы отсчёт стоит.
  const silence = createSilenceTimer({
    totalMs: timeoutMs,
    fire: () => disableConversation(true),
    onSoonChange: () => deps.onSoonChange?.()
  });

  // Тихая фраза, отброшенная по уверенности: подпись «не разобрал», три
  // подряд — подсказка про порог и микрофон.
  const unheard = createUnheardFlow({
    onCaption: (text) => deps.onUnheard?.(text),
    report: () => deps.onUnheardHint?.()
  });

  // Правило времени начала фразы: репликой становится только начавшаяся
  // после готовности слушать. Тишка занят, пока думает, работает или говорит.
  const clock = createPhraseClock({ mark: deps.mark });
  const BUSY_START = new Set(['think.start', 'tool.start', 'speak.start']);
  const BUSY_END = new Set(['idle', 'speak.end']);

  // Перед уходом по тишине значок мигает: состояние «скоро уйду» приходит за 5 секунд.
  function armTimer(): void {
    if (!conversation || answering) {
      return;
    }
    silence.arm();
  }

  function reportError(message: string): void {
    const now = Date.now();
    if (now - lastErrorAt < ERROR_COOLDOWN_MS) {
      return;
    }
    lastErrorAt = now;
    deps.bus.emit({ type: 'error', message });
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
    clock.conversationEnabled();
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
    // Уведомление не появление; реплика в том же появлении разговор не включает.
    if (source === 'trigger' || (source === 'name' && suppressed)) {
      return;
    }
    suppressed = false;
    // Горячую клавишу переключает вызывающий: это явное действие.
    if (source !== 'hotkey' && deps.getVoice().talkByDefault && owner === null) {
      requestListen('pet');
    }
  }

  // Выключение разговора: сказанное при включённом режиме и не распознанное
  // устаревает — в ядро оно не уйдёт.
  function disableConversation(hide: boolean, by?: TalkSurface): void {
    const surface = by ?? owner;
    conversation = false;
    owner = null;
    clock.conversationDisabled();
    queue.conversationDisabled();
    silence.clear();
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
    // Во время работы слушаем ради остановки: «стоп» останавливает, остальные
    // фразы в ядро не уходят.
    if (deps.onBusyPhrase?.(text) ?? false) return;
    if (isDismiss(text, deps.getVoice().wakeWords)) { dismiss(); return; }
    // Вызов без просьбы при уже видимом еже: готовый ответ, модель не нужна.
    if (isSummonOnly(text, deps.getVoice().wakeWords)) {
      deps.bus.emit({ type: 'reply', reply: { say: SUMMON_REPLY } });
      silence.clear();
      return;
    }
    silence.clear();
    answering = true;
    void deps.core
      .handleUserText(text)
      .catch(() => undefined)
      .finally(() => {
        answering = false;
        armTimer();
      });
  }

  // Обращение по имени: true — фраза обработана (показана запись или ушла
  // просьба). Обращение без просьбы при включённом разговоре уже обработано.
  function routeWake(text: string): boolean {
    const match = matchWake(text, deps.getVoice().wakeWords);
    if (!match.matched) {
      return false;
    }
    // Слова вызова («приходи», «иди сюда») — обращение, а не просьба: они
    // срезаются, в ядро уходит только настоящая просьба после них.
    const summon = stripSummon(match.rest);
    const request = summon.summoned ? summon.request : match.rest;
    // Просьба с именем при занятом Тишке: остановка или молчаливое отбрасывание.
    if (request !== '' && (deps.onBusyPhrase?.(request) ?? false)) return true;
    deps.bus.emit({ type: 'wake', source: 'name' });
    if (request === '') {
      if (!conversation) startListen();
      return true;
    }
    if (isDismiss(request, deps.getVoice().wakeWords)) { dismiss(); return true; }
    // При просьбе отдельная запись не запускается: включается разговор.
    answering = true;
    if (!conversation && !suppressed) enableConversation();
    void deps.core
      .handleUserText(request)
      .catch(() => undefined)
      .finally(() => {
        answering = false;
        armTimer();
      });
    return true;
  }

  // Текст направляется по времени начала фразы: репликой становится только
  // начавшаяся после готовности слушать. Сказанное раньше проверяется только на
  // имя (разговор выключен) и на слово остановки (Тишка занят) — в ядро не уходит.
  function onResult(result: TranscribeResult, stale: boolean, startedAt: number, speechMs: number): void {
    if (result.ok) {
      // Речь распознана: серия неуверенных фраз прервана.
      unheard.heard();
      if (stale) {
        routeStaleText(staleDeps, result.text);
      } else {
        const decision = clock.decide(startedAt);
        if (decision.kind === 'reply') {
          routeConversation(result.text);
        } else if (conversation) {
          if (!(deps.onBusyPhrase?.(result.text) ?? false)) {
            clock.drop(decision.reason);
          }
        } else if (!routeWake(result.text)) {
          clock.drop(decision.reason);
        }
      }
      armTimer();
      return;
    }
    // Тихая фраза: текст был, но уверенность ниже порога. В разговоре ёж
    // коротко показывает подписью «не разобрал».
    if (result.unreliable === true) {
      if (conversation) {
        unheard.dropped();
      }
      armTimer();
      return;
    }
    // Шум и короткий звук человеку не показываем; настоящий промах — подсказка о калибровке.
    if (result.empty === true) {
      if (isMissedSpeech(result, speechMs)) {
        deps.onMissedSpeech?.();
      }
      silence.resume();
      return;
    }
    if (result.error !== 'Не расслышал') {
      reportError(result.error);
    }
    armTimer();
  }

  // Фраза распознаётся, пока включён разговор или прослушивание имени. Во время
  // ответа в разговоре фразы всё ещё распознаются: среди них может быть «стоп».
  function acceptPhrase(): boolean {
    if (answering) {
      return conversation;
    }
    return conversation || deps.getVoice().wakeEnabled;
  }

  // Пока фраза распознаётся, таймер тишины разговора стоит: медленное
  // распознавание не закрывает разговор и фраза не пропадает.
  function transcribe(wav: Uint8Array): Promise<TranscribeResult> {
    silence.pause();
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
    if (BUSY_START.has(event.type)) {
      clock.busyChanged(true);
    } else if (BUSY_END.has(event.type)) {
      clock.busyChanged(false);
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
      queue.add(wav, startedAt);
    },
    isConversation: () => conversation,
    conversationOwner: () => owner,
    isLeavingSoon: () => silence.soon(),
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
        waiting = null;
        deps.onWaitingChange?.();
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
      silence.clear();
      waiting = null;
      queue.dropPending();
      unsubscribe();
    }
  };
}
