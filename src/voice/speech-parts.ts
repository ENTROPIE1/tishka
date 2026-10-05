// Деление готовой к синтезу реплики на части по границам предложений.
// Первая часть уходит на синтез сразу, поэтому реплика начинает звучать,
// не дожидаясь всего текста. Внутри предложения деление — только по
// запятой или точке с запятой и только для очень длинных предложений.

// Пауза между частями при воспроизведении — как у службы синтеза.
export const PART_PAUSE_MS = 150;
// Предложение длиннее этого делится по запятой или точке с запятой.
const MAX_SENTENCE_LENGTH = 300;
// Очень короткое предложение присоединяется к соседнему: не рубленая речь.
const SHORT_SENTENCE_LENGTH = 25;

const WORD = /[0-9A-Za-zА-Яа-яЁё]/;

// Сокращения и служебные слова, точка после которых не конец предложения.
const ABBREVIATIONS = new Set([
  'т', 'е', 'д', 'п', 'г', 'гг', 'н', 'в', 'см', 'стр', 'рис', 'табл',
  'др', 'тыс', 'руб', 'коп', 'им', 'ул', 'проф', 'акад', 'напр'
]);

function wordBefore(text: string, index: number): string {
  let start = index;
  while (start > 0 && WORD.test(text[start - 1] ?? '')) {
    start -= 1;
  }
  return text.slice(start, index);
}

function wordAfter(text: string, index: number): string {
  let end = index;
  while (end < text.length && WORD.test(text[end] ?? '')) {
    end += 1;
  }
  return text.slice(index, end);
}

// Точка — конец предложения, если она не часть числа, сокращения или
// инициалов («т. е.», «5.10», «и т. д.»).
function endsSentence(text: string, index: number): boolean {
  const before = text[index - 1] ?? '';
  const after = text[index + 1] ?? '';
  if (/[0-9]/.test(before) && /[0-9]/.test(after)) {
    return false;
  }
  const word = wordBefore(text, index);
  if (word === '') {
    return false;
  }
  const lower = word.toLowerCase();
  if (ABBREVIATIONS.has(lower)) {
    return false;
  }
  if (word.length === 1) {
    const next = wordAfter(text, index + 1);
    if (next !== '' && next === next.toLowerCase() && WORD.test(next[0] ?? '')) {
      return false;
    }
  }
  return true;
}

function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    let boundary = false;
    if (char === '\n' || char === '…' || char === '!' || char === '?') {
      boundary = true;
    } else if (char === '.') {
      boundary = endsSentence(text, index);
    }
    if (boundary) {
      const piece = text.slice(start, index + 1).trim();
      if (piece !== '') {
        out.push(piece);
      }
      start = index + 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail !== '') {
    out.push(tail);
  }
  return out;
}

function hardSplit(text: string): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > MAX_SENTENCE_LENGTH) {
    const window = rest.slice(0, MAX_SENTENCE_LENGTH);
    const cut = window.lastIndexOf(' ');
    const at = cut > 0 ? cut : MAX_SENTENCE_LENGTH;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest !== '') {
    out.push(rest);
  }
  return out;
}

function splitLong(sentence: string): string[] {
  const clauses = sentence.split(/(?<=[,;])\s+/);
  const out: string[] = [];
  let current = '';
  for (const clause of clauses) {
    const merged = current === '' ? clause : `${current} ${clause}`;
    if (current !== '' && merged.length > MAX_SENTENCE_LENGTH) {
      out.push(current.trim());
      current = clause;
    } else {
      current = merged;
    }
  }
  if (current.trim() !== '') {
    out.push(current.trim());
  }
  return out.flatMap((part) => (part.length > MAX_SENTENCE_LENGTH ? hardSplit(part) : [part]));
}

// Короткие предложения присоединяются к предыдущему, кроме самого первого:
// первая часть может остаться короткой, чтобы звук начался быстрее.
function mergeShort(parts: string[]): string[] {
  const out: string[] = [];
  for (const part of parts) {
    if (out.length > 0 && part.length < SHORT_SENTENCE_LENGTH) {
      out[out.length - 1] = `${out[out.length - 1]} ${part}`.trim();
    } else {
      out.push(part);
    }
  }
  return out;
}

// Делит подготовленный текст реплики на части для раздельного синтеза.
export function splitForSpeech(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed === '') {
    return [];
  }
  const parts: string[] = [];
  for (const sentence of splitSentences(trimmed)) {
    if (sentence.length > MAX_SENTENCE_LENGTH) {
      parts.push(...splitLong(sentence));
    } else {
      parts.push(sentence);
    }
  }
  return mergeShort(parts);
}
