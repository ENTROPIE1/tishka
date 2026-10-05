import { describe, expect, it } from 'vitest';
import { filterHallucinations, isOnlyHallucination, normalizeTranscript } from '../src/voice/stt-hallucination';

// Задача 99 (Н34): Whisper на тишине и шуме выдаёт фразы из субтитров.
describe('filterHallucinations', () => {
  const always = [
    'Субтитры создавал DimaTorzok',
    'субтитры сделал dimaTORZOK',
    'СУБТИТРЫ ДЕЛАЛ DimaTorzok!',
    'Субтитры при поддержке DimaTorzok...',
    'Редактор субтитров А.Семкин Корректор А.Егорова',
    'редактор субтитров а семкин',
    'КОРРЕКТОР А.ЕГОРОВА',
    'Корректор: А. Егорова'
  ];

  it.each(always)('выдумка-титры целиком отбрасывается: %s', (phrase) => {
    expect(filterHallucinations(phrase, 5)).toEqual({ text: '', dropped: true });
  });

  const sole = ['Продолжение следует', 'продолжение следует...', 'ПРОДОЛЖЕНИЕ СЛЕДУЕТ!', 'Спасибо за просмотр', 'спасибо за внимание'];
  it.each(sole)('фраза конца видео отбрасывается целиком: %s', (phrase) => {
    expect(filterHallucinations(phrase, 5)).toEqual({ text: '', dropped: true });
  });

  const short = ['Подписывайтесь на канал', 'Ставьте лайки', 'Всем пока'];
  it.each(short)('короткая просьба к зрителю отбрасывается на записи короче двух секунд: %s', (phrase) => {
    expect(filterHallucinations(phrase, 1)).toEqual({ text: '', dropped: true });
  });

  it.each(short)('та же фраза на длинной записи не трогается: %s', (phrase) => {
    const result = filterHallucinations(phrase, 5);
    expect(result.dropped).toBe(false);
    expect(result.text).toBe(phrase);
  });

  it('набор только из выдумок считается шумом', () => {
    expect(isOnlyHallucination('Субтитры создавал DimaTorzok. Продолжение следует.', 5)).toBe(true);
  });

  it('титры в начале вместе с настоящими словами вырезаются', () => {
    expect(filterHallucinations('Субтитры создавал DimaTorzok включи музыку', 5)).toEqual({
      text: 'включи музыку',
      dropped: false
    });
  });

  it('титры в конце вместе с настоящими словами вырезаются', () => {
    expect(filterHallucinations('включи музыку Субтитры создавал DimaTorzok', 5)).toEqual({
      text: 'включи музыку',
      dropped: false
    });
  });

  it('«Спасибо за внимание, отправь отчёт Ане» проходит целиком', () => {
    expect(filterHallucinations('Спасибо за внимание, отправь отчёт Ане', 5)).toEqual({
      text: 'Спасибо за внимание, отправь отчёт Ане',
      dropped: false
    });
  });

  const speech = [
    'включи музыку',
    'какие встречи сегодня',
    'Субтитры подогнал Иван',
    'Добавил субтитры Иван',
    'Amara.org',
    'Угу',
    'Ага',
    'спасибо за отчёт'
  ];
  it.each(speech)('обычная речь не затронута: %s', (phrase) => {
    expect(filterHallucinations(phrase, 5)).toEqual({ text: phrase, dropped: false });
  });
});

describe('normalizeTranscript', () => {
  it('приводит регистр, ё и пунктуацию к одному виду', () => {
    expect(normalizeTranscript('  Ёжик, ПРИВЁЛ!  ')).toBe('ежик привел');
  });
});
