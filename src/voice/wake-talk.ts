import type { Config, EventBus } from '../core/types';
import { NOT_READY_MESSAGE, planToggle } from './talk-toggle';
import { createSilenceTimer } from './silence-timer';
import type { WaitWindow } from './wake-wait';

export type WakeCommand = 'listen' | 'conversation-on' | 'conversation-off';
// Окно, владеющее режимом разговора: микрофон слушает только оно.
export type TalkSurface = 'pet' | 'chat';

const DEFAULT_TIMEOUT_SEC = 30;

export interface WakeTalkDeps {
  getVoice(): Config['voice'];
  bus: EventBus;
  wait(): WaitWindow;
  sendCommand(command: WakeCommand): void;
  hide(): void;
  isBusy(): boolean;                     // Тишка думает, работает или говорит
  reportError(message: string): void;
  onConversationEnabled(by: TalkSurface): void;
  onConversationDisabled(): void;
  onSoonChange?(): void;
  isReady?(): boolean | undefined;
}

export interface WakeTalk {
  isConversation(): boolean;
  owner(): TalkSurface | null;
  suppressed(): boolean;
  isLeavingSoon(): boolean;
  startListen(): void;
  enable(by?: TalkSurface): void;
  disable(hide: boolean, by?: TalkSurface): void;
  autoEnable(): void;                    // включить по имени, если не запрещено
  toggle(by?: TalkSurface): void;
  appear(source: 'name' | 'hotkey' | 'click' | 'trigger'): void;
  arm(): void;
  silencePause(): void;
  silenceResume(): void;
  silenceClear(): void;
  stop(): void;
}

// Ведение разговора: включение и выключение режима, таймер тишины и запрет на
// автоматическое включение до конца появления. Окно ожидания и решение по
// фразе живут отдельно; сюда они заглядывают через колбэки.
export function createWakeTalk(deps: WakeTalkDeps): WakeTalk {
  let conversation = false;
  let owner: TalkSurface | null = null;
  // Человек выключил микрофон значком: до конца этого появления не слушаем.
  let suppressed = false;

  function timeoutMs(): number {
    const seconds = deps.getVoice().talkTimeoutSec;
    return Math.max(1, Number.isFinite(seconds) ? seconds : DEFAULT_TIMEOUT_SEC) * 1000;
  }
  // Тишина разговора: на время распознавания фразы отсчёт стоит.
  const silence = createSilenceTimer({
    totalMs: timeoutMs,
    fire: () => disable(true),
    onSoonChange: () => deps.onSoonChange?.()
  });

  // Пока разговор включён и Тишка не занят, идёт отсчёт до ухода по тишине.
  function arm(): void {
    if (!conversation || deps.isBusy()) {
      return;
    }
    silence.arm();
  }
  // Обращение без просьбы: показать запись и слушать дальше.
  function startListen(): void {
    deps.bus.emit({ type: 'listen.start' });
    deps.sendCommand('listen');
  }
  // Включение разговора: ждущая фраза отбрасывается, идущее распознавание
  // помечается устаревшим в модуле решения.
  function enable(by: TalkSurface = 'pet'): void {
    conversation = true;
    owner = by;
    deps.wait().clear();
    deps.onConversationEnabled(by);
    deps.sendCommand('conversation-on');
    arm();
  }
  // Появление человека: сбрасывает выключенный значок и, если разговор включён
  // по умолчанию, сразу переводит в режим разговора. Уведомление не в счёт.
  function appear(source: 'name' | 'hotkey' | 'click' | 'trigger'): void {
    if (source === 'trigger' || (source === 'name' && suppressed)) {
      return;
    }
    suppressed = false;
    // Горячую клавишу переключает вызывающий: это явное действие.
    if (source !== 'hotkey' && deps.getVoice().talkByDefault && owner === null) {
      deps.wait().request('pet');
    }
  }
  // Выключение разговора: сказанное при включённом режиме и не распознанное
  // устаревает — в ядро оно не уйдёт.
  function disable(hide: boolean, by?: TalkSurface): void {
    const surface = by ?? owner;
    conversation = false;
    owner = null;
    deps.onConversationDisabled();
    silence.clear();
    deps.sendCommand('conversation-off');
    // Скрывается только окно-питомец: уход по тишине или просьбе в чате
    // выключает разговор, но не прячет питомца.
    if (hide && surface === 'pet') {
      deps.hide();
      suppressed = false;
    }
  }

  return {
    isConversation: () => conversation,
    owner: () => owner,
    suppressed: () => suppressed,
    isLeavingSoon: () => silence.soon(),
    startListen,
    enable,
    disable,
    autoEnable(): void {
      if (!conversation && !suppressed) {
        enable();
      }
    },
    toggle(by: TalkSurface = 'pet'): void {
      const plan = planToggle(
        {
          conversation,
          owner,
          suppressed,
          ready: deps.isReady?.() ?? true,
          starting: deps.wait().isStarting()
        },
        by
      );
      suppressed = plan.suppressed;
      if (plan.action === 'disable') {
        disable(false);
        return;
      }
      if (deps.wait().pressed(by)) {
        if (by === 'pet') {
          suppressed = true;
        }
        return;
      }
      if (plan.action === 'not-ready') {
        // Щелчок не молчит: окно узнаёт причину и остаётся выключенным.
        deps.reportError(NOT_READY_MESSAGE);
        deps.sendCommand('conversation-off');
        return;
      }
      // Готово — включить сразу; служба поднимается — дождаться готовности.
      deps.wait().request(by);
    },
    appear,
    arm,
    silencePause: () => silence.pause(),
    silenceResume: () => silence.resume(),
    silenceClear: () => silence.clear(),
    stop(): void {
      silence.clear();
    }
  };
}
