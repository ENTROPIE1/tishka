export const CAPTION_MS = 2000;

export interface StateCaption {
  // Разовая подпись под ежом вместо подписи состояния.
  show(text: string): void;
  // Действующая подпись или undefined, когда работает подпись состояния.
  current(): string | undefined;
  dispose(): void;
}

// Разовая подпись под ёжиком (например, «не разобрал»): живёт две секунды,
// затем подпись состояния возвращается.
export function createStateCaption(onChange: () => void): StateCaption {
  let text: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    show(next: string): void {
      text = next;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = undefined;
        text = undefined;
        onChange();
      }, CAPTION_MS);
      onChange();
    },
    current: () => text,
    dispose(): void {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      text = undefined;
    }
  };
}
