import { describe, expect, it } from 'vitest';
import { bubbleSay, LISTEN_SAY } from '../src/renderer/pet/listen-ui';
import { CANNED } from '../src/voice/canned';

describe('bubbleSay: облачко согласовано с речью', () => {
  it('неготовое распознавание: нейтральное приветствие вместо «Слушаю…»', () => {
    const text = bubbleSay({ modelSay: CANNED.neutral, state: 'listening', listening: true, conversation: false });
    expect(text).toBe(CANNED.neutral);
    expect(text).not.toBe(LISTEN_SAY);
  });

  it('готовая запись: пока звучит приветствие — оно, после речи — «Слушаю…»', () => {
    expect(
      bubbleSay({ modelSay: CANNED.greeting, state: 'listening', listening: true, conversation: false })
    ).toBe(CANNED.greeting);
    expect(bubbleSay({ state: 'listening', listening: true, conversation: false })).toBe(LISTEN_SAY);
  });

  it('речь выключена: при появлении показываем приветствие', () => {
    expect(
      bubbleSay({ modelSay: CANNED.greeting, state: 'listening', listening: false, conversation: false })
    ).toBe(CANNED.greeting);
  });

  it('без записи и без речи облачко пустое', () => {
    expect(bubbleSay({ state: 'idle', listening: false, conversation: false })).toBe('');
  });

  it('ответ важнее «Слушаю…»: показываем текст ответа', () => {
    expect(bubbleSay({ modelSay: 'Готово', state: 'talking', listening: true, conversation: false })).toBe('Готово');
  });

  it('ошибка показывается только в состоянии «не понял»', () => {
    expect(bubbleSay({ state: 'confused', listening: false, conversation: false, error: 'беда' })).toBe('беда');
    expect(bubbleSay({ state: 'idle', listening: false, conversation: false, error: 'беда' })).toBe('');
  });
});
