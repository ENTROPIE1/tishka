import { RigPlayer } from '../character-rig/rig-player';
import type { Character } from './character';
import { RigCharacter } from './rig-character';
import { SvgHedgehog } from './svg-hedgehog';

export interface CharacterSource {
  kind: string;
  label: string;
}

// Единственное место, где перечислены доступные для стенда форматы персонажа.
export const CHARACTER_SOURCES: CharacterSource[] = [{ kind: 'svg', label: 'Заглушка SVG' }];

export function createCharacter(kind: string): Character {
  if (kind === 'svg' || kind === 'hedgehog') {
    return new SvgHedgehog();
  }
  if (kind === 'rig' || kind === 'tishka') {
    return new RigCharacter(new RigPlayer());
  }
  throw new Error(`character-factory: неизвестный вид персонажа «${kind}»`);
}

// Персонаж для окна ежа: новый монтируется с проигрывателем, при неудаче —
// прежний ёж и строка в журнале времени. Приложение не падает.
export async function loadCharacter(
  kind: string,
  container: HTMLElement,
  log: (message: string) => void
): Promise<Character> {
  const character = createCharacter(kind);
  try {
    await character.mount(container);
    return character;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    character.dispose();
    container.replaceChildren();
    log(`персонаж «${kind}» не загрузился: ${message}; используется прежний ёж`);
    const fallback = new SvgHedgehog();
    await fallback.mount(container);
    return fallback;
  }
}
