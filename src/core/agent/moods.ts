// Набор эмоций персонажа берётся из данных модели, а не из кода.

import moodsData from '../../../assets/tishka/model/moods.json';

const MOODS = moodsData as Record<string, Record<string, unknown>>;

export function moodNames(): string[] {
  return Object.keys(MOODS);
}

export function isKnownMood(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(MOODS, name);
}
