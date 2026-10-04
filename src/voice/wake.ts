export const WAKE_PROMPT = 'Разговор с помощником по имени Тишка.';
export const DISMISS_REPLY = 'Фыр. Я рядом.';

const PERSON_NAME_LIMIT = 100;

// Подсказка распознаванию: имя помощника и, если человек сохранил своё имя в
// памяти, оно тоже — служба реже путает имена вроде «Эвелина» и «Ивелина».
export function wakePrompt(wakeWords: string[], personName?: string): string {
  const name = wakeWords.map((word) => word.trim()).find((word) => word !== '') ?? 'Тишка';
  const base = `Разговор с помощником по имени ${name}.`;
  const suffix = personName?.trim().slice(0, PERSON_NAME_LIMIT) ?? '';
  return suffix === '' ? base : `${base} ${suffix}`;
}

export interface WakeState {
  active: boolean;
  conversation: boolean;
  soon: boolean;
  sensitivity?: 'low' | 'normal' | 'high';
  threshold?: number | null;
}

// Состояние режима разговора в окне чата.
export interface ChatTalkState {
  active: boolean;
  conversation: boolean;
  soon: boolean;
  sensitivity: 'low' | 'normal' | 'high';
  threshold?: number | null;
}

export interface WakeMatch {
  matched: boolean;
  rest: string;
}

const EXCLUDED = new Set(['тишина', 'тише', 'тишь', 'мишка', 'тяжко', 'книжка']);

const DISTORTIONS: string[] = [
  'тишко', 'тишку', 'тишке', 'тишки', 'тишкa', 'тихка', 'тышка', 'тишь ка', 'тишка-тишка'
];

const DISMISS_PHRASES = [
  'уходи', 'уйди', 'пока', 'всё, спасибо', 'спасибо, всё', 'отбой', 'хватит', 'можешь идти', 'свободен'
];

const LATIN: Record<string, string> = {
  a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у'
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/ё/g, 'е').replace(/[abcehkmoptyx]/g, (ch) => LATIN[ch] ?? ch);
}

// Ключ слова: только буквы, латинские двойники приведены к кириллице.
function key(text: string): string {
  return normalize(text).replace(/[^а-яa-z]/g, '');
}

function squashed(text: string): string {
  return key(text).replace(/\s+/g, '');
}

function withinOneEdit(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }
  if (Math.abs(a.length - b.length) > 1) {
    return false;
  }
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) {
      return false;
    }
    if (a.length > b.length) {
      i += 1;
    } else if (b.length > a.length) {
      j += 1;
    } else {
      i += 1;
      j += 1;
    }
  }
  if (i < a.length || j < b.length) {
    edits += 1;
  }
  return edits <= 1;
}

function matchesWord(candidate: string, wakeKey: string): boolean {
  if (candidate === '' || EXCLUDED.has(candidate)) {
    return false;
  }
  if (candidate === wakeKey) {
    return true;
  }
  if (wakeKey === key('тишка') && DISTORTIONS.some((word) => key(word) === candidate)) {
    return true;
  }
  return withinOneEdit(candidate, wakeKey);
}

// Имя ищется среди первых трёх слов; учитываются одиночное слово и склейка
// двух соседних слов (распознавание иногда разделяет «тишь ка»).
export function matchWake(text: string, wakeWords: string[]): { matched: false } | { matched: true; rest: string } {
  const tokens = text.trim().split(/\s+/).filter((token) => token !== '');
  const keys = tokens.map(key);
  const names = wakeWords.map(key).filter((name) => name !== '');
  if (names.length === 0) {
    return { matched: false };
  }

  for (let i = 0; i < Math.min(3, keys.length); i += 1) {
    const windows: { start: number; end: number; value: string }[] = [];
    if (i + 1 < 3 && i + 1 < keys.length) {
      windows.push({ start: i, end: i + 2, value: keys[i] + keys[i + 1] });
    }
    windows.push({ start: i, end: i + 1, value: keys[i] });
    for (const window of windows) {
      if (names.some((name) => matchesWord(window.value, name))) {
        const rest = tokens
          .slice(window.end)
          .join(' ')
          .replace(/^[\s,;:.!?—–-]+/, '')
          .trim();
        return { matched: true, rest };
      }
    }
  }
  return { matched: false };
}

// Просьба уйти: фраза целиком, регистр и знаки не важны; имя в начале допускается.
export function isDismiss(text: string, wakeWords: string[] = ['тишка']): boolean {
  const whole = squashed(text);
  if (DISMISS_PHRASES.some((phrase) => squashed(phrase) === whole)) {
    return true;
  }
  const match = matchWake(text, wakeWords);
  if (!match.matched) {
    return false;
  }
  const rest = squashed(match.rest);
  return rest !== '' && DISMISS_PHRASES.some((phrase) => squashed(phrase) === rest);
}
