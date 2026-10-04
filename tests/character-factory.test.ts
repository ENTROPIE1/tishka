// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createCharacter, CHARACTER_SOURCES } from '../src/renderer/pet/character-factory';

afterEach(() => {
  document.body.replaceChildren();
});

describe('createCharacter', () => {
  it("вид 'svg' возвращает персонажа с десятью клипами", () => {
    const character = createCharacter('svg');
    expect(character.clips()).toHaveLength(10);
  });

  it('виды из списка источников собираются', () => {
    for (const source of CHARACTER_SOURCES) {
      expect(createCharacter(source.kind).clips()).toHaveLength(10);
    }
  });

  it('неизвестный вид даёт понятную ошибку', () => {
    expect(() => createCharacter('rive')).toThrowError(/неизвестный вид/);
  });
});
