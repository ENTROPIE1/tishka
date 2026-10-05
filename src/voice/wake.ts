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
  waiting?: boolean;   // служба распознавания ещё поднимается: микрофон ждёт
  threshold?: number | null;
}

// Состояние режима разговора в окне чата.
export interface ChatTalkState {
  active: boolean;
  conversation: boolean;
  soon: boolean;
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

// Обороты, обращённые к Тишке. Одиночное «свободен» сюда не входит: внутри
// реплики оно чаще о самом человеке («я сегодня свободен»), поэтому ищется
// только как фраза целиком.
const DISMISS_TURNS = [
  'уходи', 'уйди', 'ты свободен', 'ты пока свободен', 'можешь идти',
  'можешь быть свободен', 'можешь пока быть свободен', 'иди отдыхай',
  'пока иди', 'пока не нужен', 'спрячься', 'скройся'
];

// «Пока», «свободен» и вежливые фразы ищутся только целиком: как оборот
// внутри реплики они многозначны («подожди, пока загрузится»).
const DISMISS_PHRASES = [
  ...DISMISS_TURNS, 'свободен', 'пока', 'всё, спасибо', 'спасибо, всё', 'отбой', 'хватит'
];

// Порог длины: реплика длиннее — фраза по делу, а не просьба уйти.
const DISMISS_MAX_WORDS = 5;
const DISMISS_NEGATION = 'не';
const DISMISS_QUESTIONS = new Set([
  'когда', 'почему', 'зачем', 'сколько', 'где', 'куда', 'откуда', 'кто', 'ли', 'разве', 'неужели'
]);
// Подлежащее в первом лице: часть реплики о самом человеке («я сегодня
// свободен», «мне пока не нужен отчёт») просьбой уйти не считается.
const DISMISS_FIRST_PERSON = new Set(['я', 'мне', 'мы', 'нам']);
const DISMISS_CLAUSE_SPLIT = /[,.;:!?—–]/;

const DISMISS_TURN_KEYS = DISMISS_TURNS.map((turn) => turn.split(/\s+/).map(key));
// «Пока не нужен» считается просьбой только без дополнения после него:
// «пока не нужен» — да, «пока не нужен отчёт» — нет.
const DISMISS_TURN_NO_COMPLEMENT = DISMISS_TURNS.indexOf('пока не нужен');

// Первое вхождение оборота как подряд идущих слов; -1, если оборота нет.
function findTurn(words: string[], turn: string[]): number {
  for (let start = 0; start + turn.length <= words.length; start += 1) {
    let matched = true;
    for (let offset = 0; offset < turn.length; offset += 1) {
      if (words[start + offset] !== turn[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return start;
    }
  }
  return -1;
}

// Самый ранний и длинный оборот: в «не можешь быть свободен» отрицание стоит
// перед «можешь быть свободен», а не перед одиночным «свободен».
function dismissTurn(words: string[]): { index: number; start: number; length: number } | undefined {
  let best: { index: number; start: number; length: number } | undefined;
  for (let index = 0; index < DISMISS_TURN_KEYS.length; index += 1) {
    const turn = DISMISS_TURN_KEYS[index];
    const start = findTurn(words, turn);
    if (start < 0) {
      continue;
    }
    if (best === undefined || start < best.start || (start === best.start && turn.length > best.length)) {
      best = { index, start, length: turn.length };
    }
  }
  return best;
}

// Часть реплики о самом человеке: подлежащее в первом лице.
function isFirstPerson(words: string[]): boolean {
  for (let i = 0; i < words.length; i += 1) {
    if (DISMISS_FIRST_PERSON.has(words[i])) {
      return true;
    }
    if (words[i] === 'у' && i + 1 < words.length && words[i + 1] === 'меня') {
      return true;
    }
  }
  return false;
}

// Просьба уйти по смыслу: ключевой оборот, обращённый к Тишке, внутри
// короткой реплики без отрицания, вопроса и частей о самом человеке.
// Реплика делится на части по знакам, каждая часть проверяется отдельно:
// «всё хорошо, можешь быть свободен» — просьба.
function isDismissByMeaning(text: string): boolean {
  if (text.includes('?')) {
    return false;
  }
  for (const clause of text.split(DISMISS_CLAUSE_SPLIT)) {
    const words = clause.split(/\s+/).map(key).filter((word) => word !== '');
    if (words.length === 0 || words.length > DISMISS_MAX_WORDS) {
      continue;
    }
    if (words.some((word) => DISMISS_QUESTIONS.has(word))) {
      continue;
    }
    if (isFirstPerson(words)) {
      continue;
    }
    const turn = dismissTurn(words);
    if (turn === undefined) {
      continue;
    }
    if (turn.start > 0 && words[turn.start - 1] === DISMISS_NEGATION) {
      continue;
    }
    if (turn.index === DISMISS_TURN_NO_COMPLEMENT && turn.start + turn.length < words.length) {
      continue;
    }
    return true;
  }
  return false;
}

// Просьба уйти: фраза целиком или по смыслу; регистр, знаки и вводные слова
// не важны, имя в начале допускается. Отрицания, вопросы и длинная фраза
// по делу с оборотом внутри просьбой уйти не считаются.
export function isDismiss(text: string, wakeWords: string[] = ['тишка']): boolean {
  const whole = squashed(text);
  if (DISMISS_PHRASES.some((phrase) => squashed(phrase) === whole)) {
    return true;
  }
  const match = matchWake(text, wakeWords);
  if (match.matched && match.rest !== '') {
    const rest = squashed(match.rest);
    if (DISMISS_PHRASES.some((phrase) => squashed(phrase) === rest)) {
      return true;
    }
  }
  return isDismissByMeaning(text);
}

// Слова остановки текущей работы: короткая отдельная фраза, сказанная в
// разговоре, пока Тишка думает, работает или говорит.
const STOP_PHRASES = ['стоп', 'хватит', 'остановись', 'отмена'];
const STOP_KEYS = new Set(STOP_PHRASES.map((phrase) => squashed(phrase)));

// Стоп-слово сказано отдельной короткой фразой: целиком или сразу после имени.
export function isStopPhrase(text: string, wakeWords: string[] = ['тишка']): boolean {
  if (STOP_KEYS.has(squashed(text))) {
    return true;
  }
  const match = matchWake(text, wakeWords);
  return match.matched && match.rest !== '' && STOP_KEYS.has(squashed(match.rest));
}
