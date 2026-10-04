import { cardinal, ordinalGenitive, ordinalNeuter, plural } from './numbers';

const MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря'
];

const MONTH_PATTERN = MONTHS.join('|');

const DATE_KEEP_NEUTER = ['сегодня', 'завтра', 'вчера'];

// Дата после слова без предлога произносится в родительном падеже («четвёртого октября»).
// Именительный («четвёртое октября») остаётся, если дата — первое слово фразы
// или перед ней стоит «сегодня», «завтра», «вчера».
function dateIsGenitive(whole: string, offset: number): boolean {
  const before = whole.slice(0, offset).replace(/\s+$/, '');
  if (before === '' || /[.!?]$/.test(before)) {
    return false;
  }
  const lastWord = /([А-Яа-яЁё]+)[^А-Яа-яЁё]*$/.exec(before);
  if (lastWord !== null && DATE_KEEP_NEUTER.includes(lastWord[1].toLowerCase())) {
    return false;
  }
  return true;
}

export function yearWords(year: number): string {
  const value = Math.trunc(year);
  if (value >= 2000 && value < 3000) {
    const rest = value % 1000;
    return rest === 0 ? 'двухтысячного' : `две тысячи ${ordinalGenitive(rest)}`;
  }
  if (value >= 1000 && value < 2000) {
    const rest = value % 1000;
    return rest === 0 ? 'тысячного' : `тысяча ${ordinalGenitive(rest)}`;
  }
  return ordinalGenitive(value);
}

export function timeWords(hour: number, minute: number): string {
  const hours = `${cardinal(hour, 'm')} ${plural(hour, 'час', 'часа', 'часов')}`;
  if (minute === 0) {
    return `${hours} ровно`;
  }
  const minutes = `${cardinal(minute, 'f')} ${plural(minute, 'минута', 'минуты', 'минут')}`;
  return `${hours} ${minutes}`;
}

export function prepareDateTimes(text: string): string {
  let out = text.replace(
    /(\d{1,2})\.(\d{1,2})\.(\d{4})/g,
    (_match: string, day: string, month: string, year: string, offset: number, whole: string) => {
      const dayNumber = Number(day);
      const monthNumber = Number(month);
      if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) {
        return `${day}.${month}.${year}`;
      }
      const dayWord = dateIsGenitive(whole, offset) ? ordinalGenitive(dayNumber) : ordinalNeuter(dayNumber);
      return `${dayWord} ${MONTHS[monthNumber - 1]} ${yearWords(Number(year))} года`;
    }
  );

  out = out.replace(
    new RegExp(`(\\d{1,2})\\s+(${MONTH_PATTERN})(?:\\s+(\\d{4}))?`, 'gi'),
    (_match: string, day: string, name: string, year: string | undefined, offset: number, whole: string) => {
      const dayWord = dateIsGenitive(whole, offset) ? ordinalGenitive(Number(day)) : ordinalNeuter(Number(day));
      const base = `${dayWord} ${name.toLowerCase()}`;
      return year === undefined ? base : `${base} ${yearWords(Number(year))} года`;
    }
  );

  out = out.replace(/\b(\d{1,2})[:.](\d{2})\b/g, (match: string, hour: string, minute: string) => {
    const hourNumber = Number(hour);
    const minuteNumber = Number(minute);
    if (hourNumber > 23 || minuteNumber > 59) {
      return match;
    }
    return timeWords(hourNumber, minuteNumber);
  });

  return out;
}
