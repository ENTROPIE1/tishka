// Известные выдумки Whisper на тишине и шуме: фразы из субтитров, на которых
// училась модель. Источник — журнал времени и история за 5 октября (Н34):
// «Субтитры создавал DimaTorzok» (дважды) и «Продолжение следует...».
// Список намеренно не трогает «Субтитры подогнал …», «Добавил субтитры …»,
// «Amara.org», одиночные «Угу» и «Ага» — это может быть настоящей речью.

// Фразы-титры: вырезаются даже рядом с настоящими словами.
const CREDIT_PATTERNS: RegExp[] = [
  /субтитры[\s\S]{0,40}?dimatorzok/giu,
  /(?:редактор\s+субтитров|корректор)(?:\s+[А-ЯЁA-Z][\p{L}.]*)*/giu
];

// Маркеры конца видео и просьбы к зрителю: выдумка, только если ими исчерпана
// вся расшифровка. Иначе это может быть частью настоящей фразы.
const SOLE_HALLUCINATIONS = ['продолжение следует', 'спасибо за просмотр', 'спасибо за внимание'];

// То же, но на очень короткой записи: там осмысленной речи быть не может.
const SHORT_SOLE_HALLUCINATIONS = ['подписывайтесь на канал', 'ставьте лайки', 'всем пока'];
const SHORT_RECORDING_SEC = 2;

const EDGE_PUNCTUATION = /^[\s,.;:!?—–-]+|[\s,.;:!?—–-]+$/g;

export interface HallucinationResult {
  text: string;      // расшифровка без вырезанных титров
  dropped: boolean;  // вся расшифровка оказалась выдумкой
}

// Сравнение фраз: без регистра, знаков препинания, «ё/е» и лишних пробелов.
export function normalizeTranscript(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Титры в нормализованном виде: после метки идёт короткий набор имён. Ограничение
// по числу слов не даёт проглотить настоящую речь, идущую следом.
const NORMALIZED_DIMA = /субтитры[\s\S]{0,40}?dimatorzok/g;
const NORMALIZED_CORRECTOR = /корректор(?: [\p{L}\p{N}]+){0,3}/gu;
const NORMALIZED_EDITOR = /редактор субтитров(?: [\p{L}\p{N}]+){0,3}/gu;

// Выдумка целиком: фраза из списка или набор только таких фраз.
export function isOnlyHallucination(text: string, durationSec: number): boolean {
  let rest = normalizeTranscript(text);
  if (rest === '') {
    return true;
  }
  rest = rest
    .replace(NORMALIZED_DIMA, ' ')
    .replace(NORMALIZED_CORRECTOR, ' ')
    .replace(NORMALIZED_EDITOR, ' ');
  for (const phrase of SOLE_HALLUCINATIONS) {
    rest = rest.split(phrase).join(' ');
  }
  if (durationSec > 0 && durationSec < SHORT_RECORDING_SEC) {
    for (const phrase of SHORT_SOLE_HALLUCINATIONS) {
      rest = rest.split(phrase).join(' ');
    }
  }
  return normalizeTranscript(rest) === '';
}

// Отсев выдумок: полностью выдуманная расшифровка отбрасывается, а титры в
// начале или в конце настоящей фразы вырезаются, остальное остаётся.
export function filterHallucinations(text: string, durationSec: number): HallucinationResult {
  if (isOnlyHallucination(text, durationSec)) {
    return { text: '', dropped: true };
  }
  let result = text;
  for (const pattern of CREDIT_PATTERNS) {
    const flags = pattern.flags.replace('g', '');
    const source = pattern.source;
    result = result
      .replace(new RegExp(`^\\s*(?:${source})`, flags), ' ')
      .replace(new RegExp(`(?:${source})\\s*$`, flags), ' ');
  }
  result = result.replace(/\s+/g, ' ').replace(EDGE_PUNCTUATION, '');
  return { text: result.trim(), dropped: false };
}
