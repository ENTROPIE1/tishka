// Переходник между окном ежа и проигрывателем костной модели. Окно ежа знает
// только Character; сюда приходят готовые клипы и уровень громкости речи.

import { PET_TISHKA_SIZE, type PetCharacterSize } from '../../pet/character-size';
import { CLIP_NAMES, type Character, type ClipName } from './character';

// Рот покоя и две открытые формы — как режим «громкость» в образце модели.
export const RIG_MOUTH_REST = 0.15;
export const RIG_MOUTH_OPEN = 0.45;

export function rigMouthShape(level: number): string | null {
  if (!Number.isFinite(level) || level < RIG_MOUTH_REST) {
    return null;
  }
  return level < RIG_MOUTH_OPEN ? 'm_teeth' : 'm_a';
}

// Часть RigPlayer, которой пользуется переходник. Проигрыватель подходит сюда
// структурно; в тестах вместо него — подставной.
export interface RigCharacterPlayer {
  load(): Promise<void>;
  mount(container: HTMLElement): Promise<void>;
  clips(): string[];
  play(name: string): void;
  setMouth(shape: string | null): void;
  setFlip(flipped: boolean): void;
  dispose(): void;
}

export class RigCharacter implements Character {
  private clip: ClipName = 'idle';
  private mouth: number | null = null;
  private flipped = false;
  private mounted = false;

  constructor(private readonly player: RigCharacterPlayer) {}

  async mount(container: HTMLElement): Promise<void> {
    await this.player.load();
    await this.player.mount(container);
    this.mounted = true;
    this.applyClip();
    this.player.setFlip(this.flipped);
    this.applyMouth();
  }

  setClip(name: ClipName): void {
    this.clip = (CLIP_NAMES as string[]).includes(name) ? name : 'idle';
    this.applyClip();
  }

  setMouth(level: number): void {
    this.mouth = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
    this.applyMouth();
  }

  setFlip(flipped: boolean): void {
    this.flipped = flipped;
    if (this.mounted) {
      this.player.setFlip(flipped);
    }
  }

  clips(): ClipName[] {
    return [...CLIP_NAMES];
  }

  metrics(): PetCharacterSize {
    return PET_TISHKA_SIZE;
  }

  dispose(): void {
    this.mounted = false;
    this.player.dispose();
  }

  // Клип, которого нет в модели, заменяется на idle. До загрузки модели
  // проигрыватель клипов не знает: выбор откладывается до mount.
  private applyClip(): void {
    if (!this.mounted) {
      return;
    }
    const available = this.player.clips();
    this.player.play(available.includes(this.clip) ? this.clip : 'idle');
  }

  private applyMouth(): void {
    if (this.mounted) {
      this.player.setMouth(this.mouth === null ? null : rigMouthShape(this.mouth));
    }
  }
}
