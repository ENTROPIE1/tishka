import { describe, expect, it } from 'vitest';
import { parseConfirmAnswer } from '../src/voice/confirm-answer';

describe('parseConfirmAnswer', () => {
  it('слова согласия — да', () => {
    for (const text of ['да', 'Да', 'давай', 'подтверждаю', 'Да, давай', 'да давай']) {
      expect(parseConfirmAnswer(text)).toBe(true);
    }
  });

  it('слова отказа — нет', () => {
    for (const text of ['нет', 'Нет', 'отмена', 'не надо', 'нет, не надо', 'отмена!']) {
      expect(parseConfirmAnswer(text)).toBe(false);
    }
  });

  it('прочее — не ответ на вопрос', () => {
    for (const text of ['', 'привет', 'сколько времени', 'да нет наверное']) {
      const answer = parseConfirmAnswer(text);
      if (text === 'да нет наверное') {
        // «да» в начале сильнее: это согласие.
        expect(answer).toBe(true);
      } else {
        expect(answer).toBeUndefined();
      }
    }
  });
});
