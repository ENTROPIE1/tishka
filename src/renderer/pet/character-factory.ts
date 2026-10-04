import type { Character } from './character';
import { SvgHedgehog } from './svg-hedgehog';

export interface CharacterSource {
  kind: string;
  label: string;
}

// Единственное место, где перечислены доступные форматы персонажа.
export const CHARACTER_SOURCES: CharacterSource[] = [{ kind: 'svg', label: 'Заглушка SVG' }];

export function createCharacter(kind: string): Character {
  if (kind === 'svg') {
    return new SvgHedgehog();
  }
  throw new Error(`character-factory: неизвестный вид персонажа «${kind}»`);
}
