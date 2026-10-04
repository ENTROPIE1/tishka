export interface SearchRecord {
  id: string;
  text: string;
  tags: string[];
  updated: string;
}

const STOP_WORDS = new Set([
  'для', 'или', 'это', 'что', 'как', 'где', 'когда', 'если', 'чтобы', 'мне',
  'тебе', 'меня', 'тебя', 'его', 'еще', 'ещё', 'уже', 'все', 'всё', 'они',
  'она', 'оно', 'мы', 'вы', 'быть', 'был', 'была', 'были', 'есть', 'нет',
  'но', 'же', 'ли', 'то', 'так', 'там', 'тут', 'здесь', 'очень', 'просто',
  'можно', 'нужно', 'надо', 'себе', 'свой', 'свою', 'этот', 'эта', 'эти',
  'того', 'этому', 'который', 'которая', 'которые'
]);

const MIN_WORD_LENGTH = 3;
const MIN_PREFIX_LENGTH = 4;
const PREFIX_RATIO = 0.7;
const TAG_WEIGHT = 2;

export function normalize(value: string): string {
  return value.toLowerCase().replace(/ё/g, 'е');
}

function words(value: string): string[] {
  return normalize(value)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= MIN_WORD_LENGTH && !STOP_WORDS.has(word));
}

function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let index = 0;
  while (index < max && a[index] === b[index]) {
    index += 1;
  }
  return index;
}

function wordMatches(query: string, word: string): boolean {
  const prefix = commonPrefixLength(query, word);
  if (prefix < 2) {
    return false;
  }
  if (prefix >= MIN_PREFIX_LENGTH) {
    return true;
  }
  return prefix >= Math.round(PREFIX_RATIO * Math.min(query.length, word.length));
}

function scoreRecord<T extends SearchRecord>(record: T, queryWords: string[]): number {
  const textWords = words(record.text);
  const tagWords = record.tags.flatMap((tag) => words(tag));
  let score = 0;
  for (const query of queryWords) {
    if (tagWords.some((word) => wordMatches(query, word))) {
      score += TAG_WEIGHT;
    } else if (textWords.some((word) => wordMatches(query, word))) {
      score += 1;
    }
  }
  return score;
}

// Чистая функция поиска: позже её можно заменить поиском по векторам,
// не трогая хранилище и инструменты.
export function searchRecords<T extends SearchRecord>(records: T[], query: string, limit = 5): T[] {
  const queryWords = words(query);
  if (queryWords.length === 0) {
    return [];
  }
  const scored: Array<{ record: T; score: number }> = [];
  for (const record of records) {
    const score = scoreRecord(record, queryWords);
    if (score > 0) {
      scored.push({ record, score });
    }
  }
  scored.sort((a, b) => b.score - a.score || b.record.updated.localeCompare(a.record.updated));
  return scored.slice(0, Math.max(0, limit)).map((item) => item.record);
}
