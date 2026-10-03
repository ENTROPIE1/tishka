import type { Skill } from '../types';

const ADDRESS_WORDS = new Set(['тишка', 'ежик']);
const PLEASE_WORDS = new Set(['пожалуйста']);

export function normalizePhrase(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(text: string): string[] {
  const normalized = normalizePhrase(text);
  return normalized === '' ? [] : normalized.split(' ');
}

function core(wordsOf: string[]): string[] {
  const rest = wordsOf[0] !== undefined && ADDRESS_WORDS.has(wordsOf[0]) ? wordsOf.slice(1) : wordsOf;
  return rest.filter((word) => !PLEASE_WORDS.has(word));
}

function sameWords(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((word, index) => word === b[index]);
}

export function matchSkill(text: string, skills: Skill[]): Skill | undefined {
  const asked = core(words(text));
  if (asked.length === 0) {
    return undefined;
  }

  let best: Skill | undefined;
  let bestLength = -1;

  for (const skill of skills) {
    for (const phrase of skill.phrases) {
      const phraseWords = words(phrase);
      if (phraseWords.length === 0 || !sameWords(asked, phraseWords)) {
        continue;
      }
      const length = normalizePhrase(phrase).length;
      if (length > bestLength) {
        best = skill;
        bestLength = length;
      }
    }
  }

  return best;
}
