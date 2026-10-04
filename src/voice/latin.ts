const DICTIONARY: Record<string, string> = {
  confluence: 'конфлюенс',
  jira: 'джира',
  outlook: 'аутлук',
  exchange: 'эксчейндж',
  email: 'имейл',
  'e-mail': 'имейл',
  online: 'онлайн',
  ok: 'окей',
  excel: 'эксель',
  word: 'ворд',
  teams: 'тимс',
  zoom: 'зум',
  github: 'гитхаб',
  api: 'а-пи-ай',
  url: 'ю-ар-эл',
  pdf: 'пэ-дэ-эф',
  id: 'ай-ди'
};

// Винительный падеж для слов словаря, оканчивающихся на «а».
const ACCUSATIVE_FORMS: Record<string, string> = {
  'джира': 'джиру'
};

// После этих слов латиница словаря идёт в винительном падеже: «открой джиру».
const ACCUSATIVE_TRIGGERS = new Set(['и', 'в', 'из', 'открой', 'проверь', 'посмотри', 'покажи', 'обнови', 'запусти']);

const DIGRAPHS: Array<[string, string]> = [
  ['sh', 'ш'],
  ['ch', 'ч'],
  ['th', 'т'],
  ['zh', 'ж'],
  ['kh', 'х'],
  ['ph', 'ф'],
  ['ya', 'я'],
  ['yu', 'ю'],
  ['yo', 'ё'],
  ['ts', 'ц'],
  ['ck', 'к']
];

const LETTERS: Record<string, string> = {
  a: 'а',
  b: 'б',
  c: 'к',
  d: 'д',
  e: 'е',
  f: 'ф',
  g: 'г',
  h: 'х',
  i: 'и',
  j: 'й',
  k: 'к',
  l: 'л',
  m: 'м',
  n: 'н',
  o: 'о',
  p: 'п',
  q: 'к',
  r: 'р',
  s: 'с',
  t: 'т',
  u: 'у',
  v: 'в',
  w: 'в',
  x: 'кс',
  y: 'ы',
  z: 'з'
};

const LETTER_NAMES: Record<string, string> = {
  a: 'эй',
  b: 'би',
  c: 'си',
  d: 'ди',
  e: 'и',
  f: 'эф',
  g: 'джи',
  h: 'эйч',
  i: 'ай',
  j: 'джей',
  k: 'кей',
  l: 'эл',
  m: 'эм',
  n: 'эн',
  o: 'оу',
  p: 'пи',
  q: 'кью',
  r: 'ар',
  s: 'эс',
  t: 'ти',
  u: 'ю',
  v: 'ви',
  w: 'дабл-ю',
  x: 'экс',
  y: 'уай',
  z: 'зед'
};

const LATIN_WORD = /[A-Za-z]+(?:['’.-][A-Za-z]+)*/g;

// Последнее слово перед латиницей: по нему выбирается падеж.
function previousWord(before: string): string {
  const match = before.match(/([А-Яа-яЁёA-Za-z]+)[^А-Яа-яЁёA-Za-z]*$/);
  return match === null ? '' : match[1].toLowerCase();
}

function translateWord(raw: string, prev: string): string {
  const key = raw.toLowerCase().replace(/[’]/g, "'");
  const known = DICTIONARY[key];
  if (known !== undefined) {
    if (ACCUSATIVE_TRIGGERS.has(prev)) {
      const accusative = ACCUSATIVE_FORMS[known];
      if (accusative !== undefined) {
        return accusative;
      }
    }
    return known;
  }
  const letters = key.replace(/[^a-z]/g, '');
  if (letters === '') {
    return ' ';
  }
  if (raw === raw.toUpperCase() && letters.length >= 2 && letters.length <= 4) {
    return [...letters].map((ch) => (LETTER_NAMES[ch] ?? ch).toUpperCase()).join('-');
  }
  let out = key;
  for (const [from, to] of DIGRAPHS) {
    out = out.split(from).join(to);
  }
  return [...out].map((ch) => (/[а-яё]/.test(ch) ? ch : LETTERS[ch] ?? '')).join('');
}

export function prepareLatin(text: string): string {
  return text.replace(LATIN_WORD, (word: string, offset: number) => translateWord(word, previousWord(text.slice(0, offset))));
}
