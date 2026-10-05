// Перетаскивание ежа мышью или пером: начало по нажатию, конец по отпусканию,
// отмене указателя, потере фокуса окном и в любом случае не позже, чем через
// DRAG_IDLE_MS без движения — чтобы потерянное событие не оставило окно
// прилипшим к курсору, а запись заглушённой.
export const DRAG_IDLE_MS = 10000;
const DRAG_MOVE_THRESHOLD = 3;

export interface DragHandlers {
  onBegin(): void;               // нажатие: пауза записи, окно готово двигаться
  onMove(deltaX: number): void;  // сдвиг окна за курсором
  onEnd(): void;                 // конец перетаскивания: отпустить окно, снять паузу
  onClick(): void;               // отпустили без движения — это щелчок
}

export interface DragController {
  down(screenX: number, button: number): void;
  move(screenX: number): void;
  up(): void;
  cancel(): void;   // отмена указателя или потеря фокуса окном
  dispose(): void;
}

export function createDrag(handlers: DragHandlers): DragController {
  let active = false;
  let moved = false;
  let lastX = 0;
  let idle: ReturnType<typeof setTimeout> | undefined;

  function clearIdle(): void {
    if (idle !== undefined) {
      clearTimeout(idle);
      idle = undefined;
    }
  }

  function armIdle(): void {
    clearIdle();
    idle = setTimeout(() => finish(true), DRAG_IDLE_MS);
  }

  // idleEnded — конец по простою или отмене: это не щелчок, строку ввода не открываем.
  function finish(noClick = false): void {
    if (!active) {
      return;
    }
    active = false;
    clearIdle();
    handlers.onEnd();
    if (!moved && !noClick) {
      handlers.onClick();
    }
  }

  return {
    down(screenX, button) {
      if (button !== 0 || active) {
        return;
      }
      active = true;
      moved = false;
      lastX = screenX;
      handlers.onBegin();
      armIdle();
    },
    move(screenX) {
      if (!active) {
        return;
      }
      const delta = screenX - lastX;
      lastX = screenX;
      if (Math.abs(delta) > DRAG_MOVE_THRESHOLD) {
        moved = true;
      }
      if (delta !== 0) {
        handlers.onMove(delta);
      }
      armIdle();
    },
    up() {
      finish();
    },
    cancel() {
      finish(true);
    },
    dispose() {
      active = false;
      clearIdle();
    }
  };
}
