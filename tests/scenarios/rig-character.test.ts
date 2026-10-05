import { describe, expect, it } from 'vitest';
import { clipForState, type ClipName } from '../../src/renderer/pet/character';
import type { PetState } from '../../src/pet/state';
import { RigCharacter, type RigCharacterPlayer } from '../../src/renderer/pet/rig-character';

// Клипы модели Тишки: найденный в задаче 101 набор.
const MODEL_CLIPS = [
  'idle',
  'walk',
  'listen',
  'talk',
  'think',
  'work',
  'found',
  'notify',
  'happy',
  'confused',
  'dance',
  'kick',
  'sleep'
];

class RecordingPlayer implements RigCharacterPlayer {
  loaded = false;
  mounted = false;
  played: string[] = [];
  flips: boolean[] = [];

  async load(): Promise<void> {
    this.loaded = true;
  }

  async mount(): Promise<void> {
    this.mounted = true;
  }

  clips(): string[] {
    return MODEL_CLIPS;
  }

  play(name: string): void {
    this.played.push(name);
  }

  setMouth(): void {}

  setFlip(flipped: boolean): void {
    this.flips.push(flipped);
  }

  dispose(): void {}
}

const SEQUENCE: PetState[] = [
  'appear',
  'idle',
  'listening',
  'thinking',
  'working',
  'talking',
  'notify',
  'happy',
  'confused',
  'sleep',
  'leave'
];

// Запуск приложения с персонажем «Тишка»: персонаж появляется, и смена
// состояний ежа меняет проигрываемые клипы.
describe('Сценарий: запуск с персонажем «Тишка»', () => {
  it('персонаж появляется, состояния сменяют клипы', async () => {
    const player = new RecordingPlayer();
    const character = new RigCharacter(player);

    await character.mount({} as HTMLElement);

    expect(player.loaded).toBe(true);
    expect(player.mounted).toBe(true);

    player.played.length = 0;
    player.flips.length = 0;

    const expected: ClipName[] = [];
    for (const state of SEQUENCE) {
      const { clip, flip } = clipForState(state);
      character.setClip(clip);
      character.setFlip(flip);
      expected.push(clip);
    }

    expect(player.played).toEqual(expected);
    expect(player.played).toContain('walk');
    expect(player.played).toContain('think');
    // Появление идёт отражённым, обычные состояния — нет.
    expect(player.flips[0]).toBe(true);
    expect(player.flips[1]).toBe(false);
  });
});
