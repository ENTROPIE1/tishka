// Известные выдумки Whisper на тишине и шуме: фразы из субтитров, на которых
// училась модель. Источник — журнал времени и история за 5 октября (Н34):
// «Субтитры создавал DimaTorzok» (дважды) и «Продолжение следует...».
// Список намеренно не трогает «Субтитры подогнал …», «Добавил субтитры …»,
// «Amara.org», одиночные «Угу» и «Ага» — это может быть настоящей речью.

// Метка кредита ищется без учёта регистра, а имя после неё — по исходному
// тексту: «корректор прислал правки» настоящая речь, её вырезать нельзя.
const CREDIT_MARK = /редактор\s+субтитров|корректор/giu;
const CREDIT_DIMA = /субтитры[\s\S]{0,40}?dimatorzok/giu;
const NAME_TAIL = /^[:\s]+[А-ЯЁA-Z][\p{L}.]*(?:\s+[А-ЯЁA-Z][\p{L}.]*)*/u;

// Маркеры конца видео и просьбы к зрителю: выдумка, только если ими исчерпана
// вся расшифровка. Иначе это может быть частью настоящей фразы. «Спасибо за
// внимание» сюда не входит: человек так говорит, одиночная фраза — не выдумка.
const SOLE_HALLUCINATIONS = ['продолжение следует', 'спасибо за просмотр'];

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

// Вырезает титры-кредиты вместе с именами: «Корректор Иванова», «Редактор
// субтитров А.Семкин». Метка без имени («корректор прислал правки») остаётся.
function stripCredits(text: string): string {
  const source = text.replace(CREDIT_DIMA, ' ');
  const mark = new RegExp(CREDIT_MARK.source, 'giu');
  let result = '';
  let last = 0;
  for (let match = mark.exec(source); match !== null; match = mark.exec(source)) {
    result += source.slice(last, match.index);
    const names = NAME_TAIL.exec(source.slice(match.index + match[0].length));
    if (names === null) {
      result += match[0];
      last = match.index + match[0].length;
    } else {
      last = match.index + match[0].length + names[0].length;
    }
  }
  return result + source.slice(last);
}

// Выдумка целиком: фраза из списка или набор только таких фраз.
export function isOnlyHallucination(text: string, durationSec: number): boolean {
  let rest = normalizeTranscript(stripCredits(text));
  if (rest === '') {
    return true;
  }
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

// Отсев выдумок: полностью выдуманная расшифровка отбрасывается, а титры рядом
// с настоящими словами вырезаются, остальное остаётся.
export function filterHallucinations(text: string, durationSec: number): HallucinationResult {
  if (isOnlyHallucination(text, durationSec)) {
    return { text: '', dropped: true };
  }
  const result = stripCredits(text).replace(/\s+/g, ' ').replace(EDGE_PUNCTUATION, '');
  return { text: result.trim(), dropped: false };
}
