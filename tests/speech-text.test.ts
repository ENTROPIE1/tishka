import { describe, expect, it } from 'vitest';
import { prepareForSpeech } from '../src/voice/speech-text';

const NO_DIGITS_OR_LATIN = /[0-9A-Za-z]/;

describe('prepareForSpeech: время и даты', () => {
  it('время словами', () => {
    expect(prepareForSpeech('Встреча в 9:30')).toBe('Встреча в девять часов тридцать минут');
    expect(prepareForSpeech('в 16:00')).toBe('в шестнадцать часов ровно');
    expect(prepareForSpeech('09.30')).toBe('девять часов тридцать минут');
  });

  it('даты словами, год только когда он есть', () => {
    expect(prepareForSpeech('04.10.2026')).toBe('четвёртое октября две тысячи двадцать шестого года');
    expect(prepareForSpeech('4 октября')).toBe('четвёртое октября');
  });

  it('дата после слова — в родительном падеже', () => {
    expect(prepareForSpeech('Страница обновилась 04.10.2026')).toBe(
      'Страница обновилась четвёртого октября две тысячи двадцать шестого года'
    );
    expect(prepareForSpeech('Страница обновилась 4 октября')).toBe('Страница обновилась четвёртого октября');
  });

  it('дата в именительном для сегодня, завтра, вчера и в начале фразы', () => {
    expect(prepareForSpeech('сегодня 4 октября')).toBe('сегодня четвёртое октября');
    expect(prepareForSpeech('завтра 04.10.2026')).toBe('завтра четвёртое октября две тысячи двадцать шестого года');
    expect(prepareForSpeech('Готово. 04.10.2026')).toBe('Готово. четвёртое октября две тысячи двадцать шестого года');
  });
});

describe('prepareForSpeech: числа', () => {
  it('целые словами с согласованием', () => {
    expect(prepareForSpeech('Осталось 23 задачи')).toBe('Осталось двадцать три задачи');
    expect(prepareForSpeech('21 минута')).toBe('двадцать одна минута');
  });

  it('род числительного по следующему существительному', () => {
    expect(prepareForSpeech('1 час и 2 минуты')).toBe('один час и две минуты');
    expect(prepareForSpeech('22 задачи')).toBe('двадцать две задачи');
    expect(prepareForSpeech('31 встреча')).toBe('тридцать одна встреча');
    expect(prepareForSpeech('1 письмо и 2 сообщения')).toBe('одно письмо и два сообщения');
    expect(prepareForSpeech('2 окна')).toBe('два окна');
  });

  it('проценты и дроби', () => {
    expect(prepareForSpeech('5%')).toBe('пять процентов');
    expect(prepareForSpeech('3,5')).toBe('три целых пять десятых');
  });

  it('порядковые с окончанием произносятся словами', () => {
    expect(prepareForSpeech('3-й пункт')).toBe('три пункт');
  });
});

describe('prepareForSpeech: латиница', () => {
  it('словарь и аббревиатуры', () => {
    const result = prepareForSpeech('Открой Confluence и Jira');
    expect(result).not.toMatch(/[A-Za-z]/);
    expect(result).toBe('Открой конфлюенс и джиру');
    expect(prepareForSpeech('VPN')).toBe('ВИ-ПИ-ЭН');
    expect(prepareForSpeech('API')).toBe('а-пи-ай');
  });

  it('слово на «а» склоняется после глагола и «и», иначе именительный', () => {
    expect(prepareForSpeech('Открой Confluence и Jira')).toBe('Открой конфлюенс и джиру');
    expect(prepareForSpeech('Проверь Jira')).toBe('Проверь джиру');
    expect(prepareForSpeech('Jira недоступна')).toBe('джира недоступна');
  });

  it('незнакомое слово транслитерируется', () => {
    const result = prepareForSpeech('виджет');
    expect(result).not.toMatch(/[A-Za-z]/);
  });

  it('незнакомое латинское слово транслитерируется', () => {
    const result = prepareForSpeech('widget');
    expect(result).not.toMatch(/[A-Za-z]/);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('prepareForSpeech: чистка', () => {
  it('ссылки и адреса почты', () => {
    const link = prepareForSpeech('см. https://example.com/page тут');
    expect(link).toContain('ссылка');
    expect(link).not.toContain('http');
    const mail = prepareForSpeech('пиши на user@example.com');
    expect(mail).toContain('адрес почты');
    expect(mail).not.toContain('@');
  });

  it('ссылка после двоеточия и в конце фразы — с запятой и точкой', () => {
    expect(prepareForSpeech('Подробности: https://example.com')).toBe('Подробности, ссылка.');
    expect(prepareForSpeech('Смотри https://example.com')).toBe('Смотри, ссылка.');
    expect(prepareForSpeech('Подробности: https://example.com и дальше')).toBe('Подробности, ссылка и дальше');
    expect(prepareForSpeech('см. https://example.com/page тут')).toBe('см. ссылка тут');
  });

  it('разметка и эмодзи убраны', () => {
    const markup = prepareForSpeech('**важно** и `код`');
    expect(markup).toBe('важно и код');
    const emoji = prepareForSpeech('привет 😀');
    expect(emoji).toBe('привет');
  });

  it('служебные знаки', () => {
    expect(prepareForSpeech('№5')).toBe('номер пять');
    expect(prepareForSpeech('2 + 3')).toBe('два плюс три');
    expect(prepareForSpeech('кофе & чай')).toBe('кофе и чай');
  });
});

describe('prepareForSpeech: границы', () => {
  it('длинный текст обрезан по границе предложения', () => {
    const sentence = 'Это довольно длинное предложение для проверки обрезки текста. ';
    const long = sentence.repeat(10);
    const result = prepareForSpeech(long);
    expect(result.length).toBeLessThanOrEqual(400);
    expect(result.endsWith('.')).toBe(true);
  });

  it('на наборе фраз не остаётся цифр и латиницы', () => {
    const phrases = [
      'Встреча в 9:30',
      'в 16:00',
      'Осталось 23 задачи',
      '5%',
      '3,5',
      '3-й пункт',
      'Открой Confluence и Jira',
      'VPN включи',
      'API и URL',
      'PDF файл, ID 42',
      'Excel и Word, Teams, Zoom, GitHub',
      'Outlook и Exchange',
      'отправь на email',
      'зайди online',
      'ок, хорошо',
      'http://example.com',
      'user@example.com',
      '**жирный** текст',
      '# заголовок',
      '`код`',
      '😀 улыбка',
      '№7 готово',
      '5 + 10',
      'да/нет',
      'кофе & чай',
      'Это длинное тире — пауза',
      '04.10.2026',
      '4 октября 2025',
      '1 000 000',
      'в 00:15 ночи'
    ];
    for (const phrase of phrases) {
      expect(prepareForSpeech(phrase)).not.toMatch(NO_DIGITS_OR_LATIN);
    }
  });
});
