export type ListenPauseReason = 'typing' | 'drag';

// Печать: пауза снимается через 2 секунды после последнего нажатия.
export const TYPING_RESUME_MS = 2000;
// Удержание ежа мышью: после отпускания запись молчит ещё секунду.
export const DRAG_RESUME_MS = 1000;
// Перетаскивание без движения: пауза записи не держится дольше этого срока.
export const DRAG_MAX_MS = 10000;

export interface ListenPause {
  // Причина без срока держится до release(reason), со сроком — до его истечения.
  // Повторный hold сдвигает срок: печать молчит 2 секунды после последнего нажатия.
  hold(reason: ListenPauseReason, resumeMs?: number): void;
  release(reason: ListenPauseReason): void;
  isPaused(): boolean;
  dispose(): void;
}

// Единый механизм паузы прослушивания: набор причин со сроками, пауза идёт,
// пока активна хоть одна причина. О изменении состояния сообщает один раз.
export function createListenPause(onChange: (paused: boolean) => void): ListenPause {
  const holds = new Map<ListenPauseReason, ReturnType<typeof setTimeout> | undefined>();
  let paused = false;

  function update(): void {
    const next = holds.size > 0;
    if (next === paused) {
      return;
    }
    paused = next;
    onChange(next);
  }

  function clear(reason: ListenPauseReason): void {
    const timer = holds.get(reason);
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }

  return {
    hold(reason, resumeMs) {
      clear(reason);
      if (resumeMs === undefined) {
        holds.set(reason, undefined);
      } else {
        holds.set(
          reason,
          setTimeout(() => {
            holds.delete(reason);
            update();
          }, resumeMs)
        );
      }
      update();
    },
    release(reason) {
      if (!holds.has(reason)) {
        return;
      }
      clear(reason);
      holds.delete(reason);
      update();
    },
    isPaused: () => paused,
    dispose() {
      for (const timer of holds.values()) {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
      }
      holds.clear();
      update();
    }
  };
}
