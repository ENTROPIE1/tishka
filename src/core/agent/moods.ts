// Набор эмоций персонажа берётся из данных модели, а не из кода.

import moodsData from '../../../assets/tishka/model/moods.json';

const MOODS = moodsData as Record<string, { ru?: string; emote?: boolean; alias?: boolean }>;

export function moodNames(): string[] {
  return Object.keys(MOODS);
}

// «joy — радость» для подсказки модели; сценки (короткие движения) отдельно.
export function moodHints(): { emotions: string[]; emotes: string[] } {
  const emotions: string[] = [];
  const emotes: string[] = [];
  for (const [name, info] of Object.entries(MOODS)) {
    if (info.alias === true) {
      continue;
    }
    const line = info.ru !== undefined ? `${name} — ${info.ru}` : name;
    (info.emote === true ? emotes : emotions).push(line);
  }
  return { emotions, emotes };
}

export function isKnownMood(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(MOODS, name);
}
