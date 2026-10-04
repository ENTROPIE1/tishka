export const CANNED = {
  greeting: 'Фыр. Слушаю.',
  // Пока служба распознавания поднимается, «слушаю» обещать нельзя.
  neutral: 'Фыр. Я здесь.',
  thinking: 'Думаю…',
  error: 'Не вышло, смотри карточку',
  farewell: 'Фыр. Я рядом.'
} as const;

export const CANNED_TEXTS: string[] = [
  CANNED.greeting,
  CANNED.neutral,
  CANNED.thinking,
  CANNED.error,
  CANNED.farewell
];

// Приветствие «слушаю» уместно, только когда распознавание уже готово.
export function greetingFor(ready: boolean): string {
  return ready ? CANNED.greeting : CANNED.neutral;
}
