// Разбор голосового ответа на вопрос подтверждения. Применяется, только пока
// вопрос открыт; отдельный модуль, чтобы окна и ядро не дублировали слова.

const YES = /(^|\s)(да|давай|подтверждаю)(\s|$)/;
const NO = /(^|\s)(нет|отмена|не надо)(\s|$)/;

// true — «да», false — «нет», undefined — это не ответ на вопрос.
export function parseConfirmAnswer(text: string): boolean | undefined {
  const normalized = text
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:…]+$/g, '')
    .replace(/\s+/g, ' ');
  if (normalized === '') {
    return undefined;
  }
  if (YES.test(normalized)) {
    return true;
  }
  if (NO.test(normalized)) {
    return false;
  }
  return undefined;
}
