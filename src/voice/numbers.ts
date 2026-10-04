export type Gender = 'm' | 'f' | 'n';

const UNITS: Record<Gender, string[]> = {
  m: ['ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'],
  f: ['ноль', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'],
  n: ['ноль', 'одно', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять']
};

const TEENS = [
  'десять',
  'одиннадцать',
  'двенадцать',
  'тринадцать',
  'четырнадцать',
  'пятнадцать',
  'шестнадцать',
  'семнадцать',
  'восемнадцать',
  'девятнадцать'
];

const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];

const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

const UNITS_ORD_N = ['', 'первое', 'второе', 'третье', 'четвёртое', 'пятое', 'шестое', 'седьмое', 'восьмое', 'девятое'];

const TEENS_ORD_N = [
  'десятое',
  'одиннадцатое',
  'двенадцатое',
  'тринадцатое',
  'четырнадцатое',
  'пятнадцатое',
  'шестнадцатое',
  'семнадцатое',
  'восемнадцатое',
  'девятнадцатое'
];

const TENS_ORD_N = ['', '', 'двадцатое', 'тридцатое', 'сороковое', 'пятидесятое', 'шестидесятое', 'семидесятое', 'восьмидесятое', 'девяностое'];

const UNITS_ORD_G = ['', 'первого', 'второго', 'третьего', 'четвёртого', 'пятого', 'шестого', 'седьмого', 'восьмого', 'девятого'];

const TEENS_ORD_G = [
  'десятого',
  'одиннадцатого',
  'двенадцатого',
  'тринадцатого',
  'четырнадцатого',
  'пятнадцатого',
  'шестнадцатого',
  'семнадцатого',
  'восемнадцатого',
  'девятнадцатого'
];

const TENS_ORD_G = [
  '',
  '',
  'двадцатого',
  'тридцатого',
  'сорокового',
  'пятидесятого',
  'шестидесятого',
  'семидесятого',
  'восьмидесятого',
  'девяностого'
];

const HUNDREDS_ORD_G = [
  '',
  'сотого',
  'двухсотого',
  'трёхсотого',
  'четырёхсотого',
  'пятисотого',
  'шестисотого',
  'семисотого',
  'восьмисотого',
  'девятьсотого'
];

export function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(n) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) {
    return many;
  }
  if (mod10 === 1) {
    return one;
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return few;
  }
  return many;
}

function group(n: number, gender: Gender): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  if (hundreds > 0) {
    parts.push(HUNDREDS[hundreds]);
  }
  const rest = n % 100;
  if (rest >= 10 && rest < 20) {
    parts.push(TEENS[rest - 10]);
    return parts.join(' ');
  }
  const tens = Math.floor(rest / 10);
  if (tens > 0) {
    parts.push(TENS[tens]);
  }
  const unit = rest % 10;
  if (unit > 0) {
    parts.push(UNITS[gender][unit]);
  }
  return parts.join(' ');
}

export function cardinal(n: number, gender: Gender = 'm'): string {
  const value = Math.trunc(n);
  if (value === 0) {
    return 'ноль';
  }
  const parts: string[] = [];
  const millions = Math.floor(value / 1_000_000);
  if (millions > 0) {
    parts.push(group(millions, 'm'), plural(millions, 'миллион', 'миллиона', 'миллионов'));
  }
  const thousands = Math.floor((value % 1_000_000) / 1000);
  if (thousands > 0) {
    parts.push(group(thousands, 'f'), plural(thousands, 'тысяча', 'тысячи', 'тысяч'));
  }
  const rest = value % 1000;
  if (rest > 0) {
    parts.push(group(rest, gender));
  }
  return parts.join(' ');
}

export function ordinalNeuter(n: number): string {
  if (n < 10) {
    return UNITS_ORD_N[n] ?? '';
  }
  if (n < 20) {
    return TEENS_ORD_N[n - 10] ?? '';
  }
  const tens = Math.floor(n / 10);
  const unit = n % 10;
  return unit === 0 ? TENS_ORD_N[tens] ?? '' : `${TENS[tens]} ${UNITS_ORD_N[unit]}`;
}

export function ordinalGenitive(n: number): string {
  if (n < 10) {
    return UNITS_ORD_G[n] ?? '';
  }
  if (n < 20) {
    return TEENS_ORD_G[n - 10] ?? '';
  }
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (rest === 0) {
    return HUNDREDS_ORD_G[hundreds] ?? '';
  }
  const parts: string[] = [];
  if (hundreds > 0) {
    parts.push(HUNDREDS[hundreds]);
  }
  if (rest < 10) {
    parts.push(UNITS_ORD_G[rest]);
  } else if (rest < 20) {
    parts.push(TEENS_ORD_G[rest - 10]);
  } else {
    const tens = Math.floor(rest / 10);
    const unit = rest % 10;
    if (unit === 0) {
      parts.push(TENS_ORD_G[tens]);
    } else {
      parts.push(TENS[tens], UNITS_ORD_G[unit]);
    }
  }
  return parts.join(' ');
}

function decimalWords(intPart: string, frac: string): string {
  const intValue = Number(intPart);
  const whole = `${cardinal(intValue, 'f')} ${plural(intValue, 'целая', 'целых', 'целых')}`;
  if (frac.length === 1) {
    const digit = Number(frac);
    return `${whole} ${cardinal(digit, 'f')} ${digit === 1 ? 'десятая' : 'десятых'}`;
  }
  const digits = [...frac].map((ch) => cardinal(Number(ch), 'm')).join(' ');
  return `${whole} запятая ${digits}`;
}

function percentWords(raw: string): string {
  const hasFraction = /[.,]/.test(raw);
  const [intPart, frac] = raw.split(/[.,]/);
  const noun = hasFraction ? 'процента' : plural(Number(intPart), 'процент', 'процента', 'процентов');
  const words = hasFraction ? decimalWords(intPart, frac) : cardinal(Number(intPart), 'm');
  return `${words} ${noun}`;
}

// Основы слов, с которыми числительное согласуется по роду. Список расширяемый:
// достаточно добавить основу, чтобы «1» и «2» перед её формами читались нужным родом.
const FEMININE_STEMS = [
  'минут',
  'секунд',
  'недел',
  'задач',
  'встреч',
  'страниц',
  'верси',
  'строк',
  'ссылк',
  'запис',
  'копи',
  'тысяч',
  'штук'
];

const NEUTER_STEMS = ['письм', 'окн', 'окон', 'сообщени', 'напоминани', 'мест'];

function genderAfter(text: string, end: number): Gender {
  const match = /^\s+([А-Яа-яЁё]+)/.exec(text.slice(end));
  if (match === null) {
    return 'm';
  }
  const word = match[1].toLowerCase();
  if (FEMININE_STEMS.some((stem) => word.startsWith(stem))) {
    return 'f';
  }
  if (NEUTER_STEMS.some((stem) => word.startsWith(stem))) {
    return 'n';
  }
  return 'm';
}

const ORDINAL_SUFFIX = /(\d+)-(?:й|го|я|ое|ый|ая|ому|ым|их|его|ему|ой)(?![а-яёА-ЯЁ])/gi;

export function prepareNumbers(text: string): string {
  let out = text;
  let joined = '';
  while (joined !== out) {
    joined = out;
    out = out.replace(/(\d)[ \t](?=\d{3}(?:\D|$))/g, '$1');
  }
  out = out.replace(/(\d+(?:[.,]\d+)?)\s*%/g, (_match: string, raw: string) => percentWords(raw));
  out = out.replace(ORDINAL_SUFFIX, (_match: string, digits: string) => cardinal(Number(digits), 'm'));
  out = out.replace(/(\d+)[.,](\d+)/g, (_match: string, intPart: string, frac: string) =>
    decimalWords(intPart, frac)
  );
  out = out.replace(/\d+/g, (match: string, offset: number, whole: string) =>
    cardinal(Number(match), genderAfter(whole, offset + match.length))
  );
  return out;
}
