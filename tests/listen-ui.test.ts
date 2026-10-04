import { describe, expect, it } from 'vitest';
import { bubbleSay } from '../src/renderer/pet/listen-ui';
import { CANNED } from '../src/voice/canned';
import type { PetState } from '../src/pet/state';

const STATES: PetState[] = [
  'hidden',
  'appear',
  'idle',
  'listening',
  'thinking',
  'working',
  'talking',
  'notify',
  'happy',
  'confused',
  'leave',
  'sleep'
];

describe('bubbleSay: облачко только для слов Тишки', () => {
  it('ни при каких входах не показывает надпись «Слушаю…»', () => {
    for (const state of STATES) {
      for (const modelSay of [undefined, '', 'Готово', CANNED.greeting]) {
        for (const error of [undefined, '', 'беда']) {
          const text = bubbleSay({ modelSay, state, error });
          expect(text, `${state}, ${modelSay ?? '—'}, ${error ?? '—'}`).not.toBe('Слушаю…');
        }
      }
    }
  });

  it('ответ, приветствие и статус важнее прочего', () => {
    expect(bubbleSay({ modelSay: CANNED.greeting, state: 'listening' })).toBe(CANNED.greeting);
    expect(bubbleSay({ modelSay: 'Готово', state: 'talking' })).toBe('Готово');
    expect(bubbleSay({ modelSay: CANNED.neutral, state: 'appear' })).toBe(CANNED.neutral);
  });

  it('после конца приветствия облачко пустое, в каком бы состоянии ёж ни был', () => {
    expect(bubbleSay({ state: 'listening' })).toBe('');
    expect(bubbleSay({ state: 'appear' })).toBe('');
    expect(bubbleSay({ state: 'talking' })).toBe('');
    expect(bubbleSay({ modelSay: '', state: 'listening' })).toBe('');
  });

  it('ошибка показывается только в состоянии «не понял»', () => {
    expect(bubbleSay({ state: 'confused', error: 'беда' })).toBe('беда');
    expect(bubbleSay({ state: 'idle', error: 'беда' })).toBe('');
  });
});
