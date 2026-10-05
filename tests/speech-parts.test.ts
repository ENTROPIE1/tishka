import { describe, expect, it } from 'vitest';
import { splitForSpeech } from '../src/voice/speech-parts';

describe('splitForSpeech: границы предложений', () => {
  it('реплика из трёх длинных предложений делится на три части', () => {
    const text =
      'Первое предложение для проверки деления. ' +
      'Второе предложение для проверки деления. ' +
      'Третье предложение для проверки деления.';
    expect(splitForSpeech(text)).toEqual([
      'Первое предложение для проверки деления.',
      'Второе предложение для проверки деления.',
      'Третье предложение для проверки деления.'
    ]);
  });

  it('делит по восклицанию, вопросу, многоточию и переводу строки', () => {
    const text =
      'Как дела у тебя сегодня? Всё отлично и очень хорошо! ' +
      'Правда это или нет… Хорошо, что всё именно так\nи снова всё хорошо.';
    const parts = splitForSpeech(text);
    expect(parts.length).toBeGreaterThanOrEqual(3);
    expect(parts.join(' ')).toContain('Как дела у тебя сегодня?');
  });

  it('короткие предложения присоединяются к соседнему', () => {
    expect(splitForSpeech('Фыр. Слушаю.')).toEqual(['Фыр. Слушаю.']);
  });

  it('первая часть может остаться короткой ради быстрого звука', () => {
    const text = 'Да. Второе длинное предложение для проверки деления.';
    expect(splitForSpeech(text)).toEqual([
      'Да.',
      'Второе длинное предложение для проверки деления.'
    ]);
  });
});

describe('splitForSpeech: сокращения и числа', () => {
  it('не делит по точкам в «т. е.» и «и т. д.»', () => {
    const text = 'Это верно, т. е. так и есть, и т. д. Продолжаем дальше.';
    const parts = splitForSpeech(text);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toContain('т. е.');
    expect(parts[0]).toContain('т. д.');
  });

  it('не делит по точке внутри числа', () => {
    expect(splitForSpeech('Версия 5.10 вышла')).toEqual(['Версия 5.10 вышла']);
  });

  it('не делит после известного сокращения', () => {
    expect(splitForSpeech('См. ссылку тут')).toEqual(['См. ссылку тут']);
  });
});

describe('splitForSpeech: длинные предложения', () => {
  it('очень длинное предложение делится по запятой', () => {
    const clause = 'это очень длинная часть предложения которая проверяет деление по запятой';
    const text = `${clause}, ${clause}, ${clause}, ${clause}, ${clause}`;
    const parts = splitForSpeech(text);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(300);
    }
  });

  it('пустой текст не даёт частей', () => {
    expect(splitForSpeech('   ')).toEqual([]);
  });
});
