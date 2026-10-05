import type { Config, EventBus } from '../core/types';
import type { TimingMark } from '../main/timing-log';
import type { TranscribeResult } from './stt-service';
import { DISMISS_REPLY, SUMMON_REPLY, isDismiss, isSummonOnly, matchWake, stripSummon, wakePrompt } from './wake';
import type { BusyIntervals } from './busy-intervals';
import { createPhraseClock } from './phrase-time';
import { createPhraseQueue, routeStaleText, type StaleTextDeps } from './stale-phrase';
import { createUnheardFlow } from './unheard';
import { isMissedSpeech } from './missed-speech';
import { wavDurationSec } from './wav';
import type { WakeStateMachine } from './wake-state';
import type { WakeTalk } from './wake-talk';

export interface DecisionDeps {
  getVoice(): Config['voice'];
  core: { handleUserText(text: string): Promise<unknown> };
  stt: { transcribe(wav: Uint8Array, prompt?: string): Promise<TranscribeResult> };
  bus: EventBus;
  talk: WakeTalk;
  state: WakeStateMachine;
  busy: BusyIntervals;
  mark?: TimingMark;
  memoryName?(): string | undefined;
  onBusyPhrase?(text: string): boolean;
  onMissedSpeech?(): void;
  onUnheard?(text: string): void;
  onUnheardHint?(): void;
  onSlowStt?(): void;   // распознавание длилось дольше отрезка
  onFastStt?(): void;   // распознавание уложилось в отрезок
  reportError(message: string): void;
}

// Отрезок без опознанного заголовка считается слишком коротким, чтобы судить
// о скорости: медленным признаётся только распознавание длиннее самого звука.
function isSlowTranscribe(elapsedMs: number, speechMs: number): boolean {
  return speechMs > 0 && elapsedMs > speechMs;
}

export interface WakeDecision {
  add(wav: Uint8Array, startedAt: number): void;
  conversationEnabled(): void;
  conversationDisabled(): void;
  dropPending(): void;
}

// Приём отрезка и решение по нему: вызов, остановка, реплика или отбрасывание.
// Отрезки занятости помнят все окна Тишки, часовой пояс решения — отдельно.
export function createWakeDecision(deps: DecisionDeps): WakeDecision {
  const clock = createPhraseClock({ mark: deps.mark, busy: deps.busy });
  const unheard = createUnheardFlow({
    onCaption: (text) => deps.onUnheard?.(text),
    report: () => deps.onUnheardHint?.()
  });

  function dismiss(): void {
    deps.bus.emit({ type: 'reply', reply: { say: DISMISS_REPLY } });
    deps.talk.disable(true);
  }

  // Фраза ушла в ядро: состояние busy, пока ход не завершится.
  function startAnswer(text: string): void {
    deps.state.transition('answer');
    void deps.core
      .handleUserText(text)
      .catch(() => undefined)
      .finally(() => {
        deps.state.transition(deps.talk.isConversation() ? 'listen' : 'disable');
        deps.talk.arm();
      });
  }

  function routeConversation(text: string): void {
    // Во время работы слушаем ради остановки: «стоп» останавливает, остальные
    // фразы в ядро не уходят.
    if (deps.onBusyPhrase?.(text) ?? false) return;
    if (isDismiss(text, deps.getVoice().wakeWords)) {
      dismiss();
      return;
    }
    // Вызов без просьбы при уже видимом еже: готовый ответ, модель не нужна.
    if (isSummonOnly(text, deps.getVoice().wakeWords)) {
      deps.bus.emit({ type: 'reply', reply: { say: SUMMON_REPLY } });
      deps.talk.silenceClear();
      return;
    }
    deps.talk.silenceClear();
    startAnswer(text);
  }

  // Обращение по имени: true — фраза обработана. Обращение без просьбы при
  // включённом разговоре уже обработано.
  function routeWake(text: string): boolean {
    const match = matchWake(text, deps.getVoice().wakeWords);
    if (!match.matched) {
      return false;
    }
    // Слова вызова («приходи», «иди сюда») — обращение, а не просьба.
    const summon = stripSummon(match.rest);
    const request = summon.summoned ? summon.request : match.rest;
    if (request !== '' && (deps.onBusyPhrase?.(request) ?? false)) return true;
    deps.bus.emit({ type: 'wake', source: 'name' });
    if (request === '') {
      if (!deps.talk.isConversation()) {
        deps.talk.startListen();
        deps.state.transition('summon');
      }
      return true;
    }
    if (isDismiss(request, deps.getVoice().wakeWords)) {
      dismiss();
      return true;
    }
    // При просьбе отдельная запись не запускается: включается разговор.
    deps.state.transition('answer');
    deps.talk.autoEnable();
    startAnswer(request);
    return true;
  }

  // Текст направляется по времени начала фразы: репликой становится только
  // начавшаяся после готовности слушать.
  function onResult(result: TranscribeResult, stale: boolean, startedAt: number, speechMs: number): void {
    if (result.ok) {
      unheard.heard();
      if (stale) {
        routeStaleText(staleDeps, result.text);
      } else {
        const decision = clock.decide(startedAt);
        if (decision.kind === 'reply') {
          routeConversation(result.text);
        } else if (deps.talk.isConversation()) {
          if (!(deps.onBusyPhrase?.(result.text) ?? false)) {
            clock.drop(decision.reason);
          }
        } else if (!routeWake(result.text)) {
          clock.drop(decision.reason);
        }
      }
      deps.talk.arm();
      return;
    }
    // Тихая фраза: текст был, но уверенность ниже порога.
    if (result.unreliable === true) {
      if (deps.talk.isConversation()) {
        unheard.dropped();
      }
      deps.talk.arm();
      return;
    }
    if (result.empty === true) {
      if (isMissedSpeech(result, speechMs)) {
        deps.onMissedSpeech?.();
      }
      deps.talk.silenceResume();
      return;
    }
    if (result.error !== 'Не расслышал') {
      deps.reportError(result.error);
    }
    deps.talk.arm();
  }

  // Фраза распознаётся, пока включён разговор или прослушивание имени. Во время
  // ответа в разговоре фразы всё ещё распознаются: среди них может быть «стоп».
  function acceptPhrase(): boolean {
    if (deps.state.busy()) {
      return deps.talk.isConversation();
    }
    return deps.talk.isConversation() || deps.getVoice().wakeEnabled;
  }

  function transcribe(wav: Uint8Array): Promise<TranscribeResult> {
    deps.talk.silencePause();
    const startedAt = Date.now();
    return deps.stt
      .transcribe(wav, wakePrompt(deps.getVoice().wakeWords, deps.memoryName?.()))
      .then((result) => {
        // Скорость службы важна для подсказки: медленнее звука — копится задержка.
        if (isSlowTranscribe(Date.now() - startedAt, wavDurationSec(wav) * 1000)) {
          deps.onSlowStt?.();
        } else {
          deps.onFastStt?.();
        }
        return result;
      });
  }

  function startListenFromStale(): void {
    deps.talk.startListen();
    deps.state.transition('summon');
  }

  const staleDeps: StaleTextDeps = {
    bus: deps.bus,
    wakeWords: () => deps.getVoice().wakeWords,
    inConversation: () => deps.talk.isConversation(),
    startListen: startListenFromStale
  };

  const queue = createPhraseQueue({ accept: acceptPhrase, transcribe, onResult, mark: deps.mark });

  return {
    add: (wav, startedAt) => queue.add(wav, startedAt),
    conversationEnabled(): void {
      clock.conversationEnabled();
      queue.conversationEnabled();
      deps.state.transition('listen');
    },
    conversationDisabled(): void {
      clock.conversationDisabled();
      queue.conversationDisabled();
      deps.state.transition('disable');
    },
    dropPending: () => queue.dropPending()
  };
}
