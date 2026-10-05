import type { Config } from '../core/types';
import type { SttStatus } from './stt-service';
import type { TalkSurface } from './wake-talk';

const NOT_READY_MESSAGE = 'Распознавание речи не настроено';

export interface WaitDeps {
  getVoice(): Config['voice'];
  enable(surface: TalkSurface): void;    // поздняя привязка к ведению разговора
  isConversation(): boolean;
  owner(): TalkSurface | null;
  isSuppressed(): boolean;
  isBusy(): boolean;
  isReady?(): boolean | undefined;
  getStatus?(): SttStatus | undefined;
  isVisible?(surface: TalkSurface): boolean | undefined;
  onWaitingChange?(): void;
  reportError(message: string): void;
}

export interface WaitWindow {
  isWaiting(): boolean;
  isStarting(): boolean;
  request(by: TalkSurface): void;        // включить сейчас или дождаться службы
  pressed(by: TalkSurface): boolean;     // щелчок во время ожидания: ждать перестали
  noteReady(): void;
  noteFailed(message?: string): void;
  clear(): void;
}

// Окно ожидания готовности службы распознавания: обращение или щелчок при
// поднимающейся службе откладывает запись, а не сообщает об ошибке. Включение
// происходит один раз за появление и только если окно ещё на экране.
export function createWaitWindow(deps: WaitDeps): WaitWindow {
  let waiting: TalkSurface | null = null;

  function isStarting(): boolean {
    const status = deps.getStatus?.();
    return status !== undefined ? status === 'starting' : deps.getVoice().talkByDefault;
  }

  return {
    isWaiting: () => waiting !== null,
    isStarting,
    request(by: TalkSurface): void {
      if (deps.isReady?.() ?? true) {
        deps.enable(by);
        return;
      }
      if (waiting === by) {
        return;
      }
      waiting = by;
      deps.onWaitingChange?.();
    },
    // Значок нажали, пока ждали службу: до конца появления не слушаем.
    pressed(by: TalkSurface): boolean {
      if (waiting !== by) {
        return false;
      }
      waiting = null;
      deps.onWaitingChange?.();
      return true;
    },
    noteReady(): void {
      const surface = waiting;
      if (surface === null) {
        return;
      }
      waiting = null;
      deps.onWaitingChange?.();
      if (surface === 'pet' && deps.isSuppressed()) {
        return;
      }
      if (deps.isConversation() || deps.owner() !== null || deps.isBusy()) {
        return;
      }
      if (!(deps.isVisible?.(surface) ?? true)) {
        return;
      }
      deps.enable(surface);
    },
    noteFailed(message?: string): void {
      if (waiting === null) {
        return;
      }
      waiting = null;
      deps.onWaitingChange?.();
      if (deps.isReady?.() ?? true) {
        return;
      }
      deps.reportError(message ?? NOT_READY_MESSAGE);
    },
    clear(): void {
      waiting = null;
    }
  };
}
