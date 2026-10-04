// Отметка времени из окна: молча ничего не делает, если мост недоступен
// (например, в юнит-тестах без preload).
export function timingMark(event: string, details?: Record<string, string | number | boolean>): void {
  try {
    window.tishka?.timingMark?.(event, details);
  } catch {
    // Журнал времени не влияет на работу окна.
  }
}
