import { describe, expect, it } from 'vitest';
import { matchSkill, normalizePhrase } from '../src/core/skills/match';
import type { Skill } from '../src/core/types';

function skill(id: string, phrases: string[]): Skill {
  return {
    format: 'tishka-skill/1',
    id,
    name: id,
    description: '',
    phrases,
    trigger: { type: 'manual' },
    steps: [{ id: 'done', say: 'ок' }]
  };
}

describe('normalizePhrase', () => {
  it('приводит к нижнему регистру, ё→е, убирает знаки и лишние пробелы', () => {
    expect(normalizePhrase('  Утро Пятницы!  ')).toBe('утро пятницы');
    expect(normalizePhrase('Ёжик, всё хорошо?')).toBe('ежик все хорошо');
  });
});

describe('matchSkill', () => {
  const friday = skill('friday', ['утро пятницы']);

  it('находит навык по фразе с лишней пунктуацией', () => {
    expect(matchSkill('Утро пятницы!', [friday])).toBe(friday);
  });

  it('находит навык по фразе с обращением в начале', () => {
    expect(matchSkill('тишка, утро пятницы', [friday])).toBe(friday);
    expect(matchSkill('ёжик утро пятницы', [friday])).toBe(friday);
  });

  it('находит навык по фразе со словом «пожалуйста»', () => {
    expect(matchSkill('Утро пятницы, пожалуйста', [friday])).toBe(friday);
  });

  it('не считает частичное вхождение совпадением', () => {
    expect(matchSkill('какое сегодня утро', [friday])).toBeUndefined();
    expect(matchSkill('утро пятницы и ещё что-то', [friday])).toBeUndefined();
  });

  it('при двух навыках с фразами «утро» и «утро пятницы» выбирает второй', () => {
    const short = skill('short', ['утро']);
    const long = skill('long', ['утро пятницы']);
    expect(matchSkill('утро пятницы', [short, long])).toBe(long);
    expect(matchSkill('утро', [short, long])).toBe(short);
  });

  it('игнорирует пустой список навыков', () => {
    expect(matchSkill('утро пятницы', [])).toBeUndefined();
  });
});
