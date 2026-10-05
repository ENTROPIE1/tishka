// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PET_TISHKA_SIZE } from '../src/pet/character-size';
import { loadCharacter } from '../src/renderer/pet/character-factory';
import { CLIP_NAMES, type ClipName } from '../src/renderer/pet/character';
import { RigCharacter, rigMouthShape, type RigCharacterPlayer } from '../src/renderer/pet/rig-character';

class FakePlayer implements RigCharacterPlayer {
  loaded = false;
  mounted = false;
  disposed = false;
  failLoad = false;
  clipList: string[] = ['idle', 'walk', 'listen', 'think', 'work', 'talk', 'notify', 'happy', 'confused', 'sleep'];
  played: string[] = [];
  mouth: string | null = null;
  flip = false;

  async load(): Promise<void> {
    if (this.failLoad) {
      throw new Error('нет файлов модели');
    }
    this.loaded = true;
  }

  async mount(): Promise<void> {
    this.mounted = true;
  }

  clips(): string[] {
    return this.clipList;
  }

  play(name: string): void {
    this.played.push(name);
  }

  setMouth(shape: string | null): void {
    this.mouth = shape;
  }

  setFlip(flipped: boolean): void {
    this.flip = flipped;
  }

  dispose(): void {
    this.disposed = true;
  }
}

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('RigCharacter', () => {
  it('сообщает десять клипов и высокие пропорции', async () => {
    const character = new RigCharacter(new FakePlayer());
    expect(character.clips()).toEqual(CLIP_NAMES);
    expect(character.metrics()).toEqual(PET_TISHKA_SIZE);
    expect(character.metrics().height).toBe(260);
  });

  it('mount загружает модель и проигрывает клип', async () => {
    const player = new FakePlayer();
    const character = new RigCharacter(player);
    character.setClip('walk');

    await character.mount(document.createElement('div'));

    expect(player.loaded).toBe(true);
    expect(player.mounted).toBe(true);
    expect(player.played).toEqual(['walk']);
  });

  it('клип, которого нет в модели, заменяется на idle', async () => {
    const player = new FakePlayer();
    player.clipList = ['idle', 'walk'];
    const character = new RigCharacter(player);
    await character.mount(document.createElement('div'));

    player.played.length = 0;
    character.setClip('dance' as ClipName);
    character.setClip('walk');

    expect(player.played).toEqual(['idle', 'walk']);
  });

  it('отражение передаётся проигрывателю после монтирования', async () => {
    const player = new FakePlayer();
    const character = new RigCharacter(player);
    await character.mount(document.createElement('div'));

    character.setFlip(true);
    expect(player.flip).toBe(true);
    character.setFlip(false);
    expect(player.flip).toBe(false);
  });

  it('рот по громкости: покой, m_teeth, m_a', async () => {
    const player = new FakePlayer();
    const character = new RigCharacter(player);
    await character.mount(document.createElement('div'));

    character.setMouth(0.1);
    expect(player.mouth).toBeNull();
    character.setMouth(0.3);
    expect(player.mouth).toBe('m_teeth');
    character.setMouth(0.6);
    expect(player.mouth).toBe('m_a');
    character.setMouth(-5);
    expect(player.mouth).toBeNull();
  });

  it('dispose останавливает проигрыватель', async () => {
    const player = new FakePlayer();
    const character = new RigCharacter(player);
    await character.mount(document.createElement('div'));

    character.dispose();

    expect(player.disposed).toBe(true);
  });
});

describe('rigMouthShape', () => {
  it('границы: 0,15 — открытый, 0,45 — широкий', () => {
    expect(rigMouthShape(0.14)).toBeNull();
    expect(rigMouthShape(0.15)).toBe('m_teeth');
    expect(rigMouthShape(0.44)).toBe('m_teeth');
    expect(rigMouthShape(0.45)).toBe('m_a');
  });
});

describe('loadCharacter', () => {
  it('при отсутствии модели показывает прежнего ежа и пишет журнал', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('нет файлов')));
    const container = document.createElement('div');
    const log = vi.fn<(message: string) => void>();

    const character = await loadCharacter('tishka', container, log);

    expect(character).toBeDefined();
    expect(container.querySelector('svg.hedgehog')).not.toBeNull();
    expect(log).toHaveBeenCalledOnce();
  });

  it('смена персонажа возвращает новый экземпляр без перезапуска', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('нет файлов')));
    const container = document.createElement('div');

    const first = await loadCharacter('hedgehog', container, () => undefined);
    const second = await loadCharacter('tishka', container, () => undefined);

    expect(second).not.toBe(first);
    expect(container.querySelector('svg.hedgehog')).not.toBeNull();
  });
});
