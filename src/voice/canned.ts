export const CANNED = {
  greeting: 'Фыр. Слушаю.',
  thinking: 'Думаю…',
  error: 'Не вышло, смотри карточку',
  farewell: 'Фыр. Я рядом.'
} as const;

export const CANNED_TEXTS: string[] = [CANNED.greeting, CANNED.thinking, CANNED.error, CANNED.farewell];
