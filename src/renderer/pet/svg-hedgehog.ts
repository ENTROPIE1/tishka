import { PET_HEDGEHOG_SIZE, type PetCharacterSize } from '../../pet/character-size';
import { CLIP_NAMES, type Character, type ClipName } from './character';
import { hedgehogMarkup } from './svg-hedgehog-markup';

const TALK_TICK_MS = 110;

function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

export class SvgHedgehog implements Character {
  private root: SVGSVGElement | undefined;
  private mouthShape: Element | undefined;
  private clip: ClipName = 'idle';
  private mouth = 0;
  private flipped = false;
  private talkAuto = false;
  private talkTimer: number | undefined;

  async mount(container: HTMLElement): Promise<void> {
    this.dispose();
    container.insertAdjacentHTML('beforeend', hedgehogMarkup());

    const root = container.querySelector<SVGSVGElement>('svg.hedgehog');
    if (root === null) {
      throw new Error('svg-hedgehog: markup not found');
    }
    this.root = root;
    this.mouthShape = root.querySelector('#hh-mouth-shape') ?? undefined;
    this.applyClip();
    this.applyFlip();
    this.applyMouth();
  }

  setClip(name: ClipName): void {
    const chosen: ClipName = (CLIP_NAMES as string[]).includes(name) ? name : 'idle';
    if (chosen === this.clip && this.root !== undefined) {
      return;
    }
    this.clip = chosen;
    this.applyClip();
  }

  setMouth(level: number): void {
    this.talkAuto = false;
    this.stopTalkAuto();
    this.mouth = clamp01(level);
    this.applyMouth();
  }

  setFlip(flipped: boolean): void {
    this.flipped = flipped;
    this.applyFlip();
  }

  clips(): ClipName[] {
    return [...CLIP_NAMES];
  }

  metrics(): PetCharacterSize {
    return PET_HEDGEHOG_SIZE;
  }

  dispose(): void {
    this.stopTalkAuto();
    if (this.root !== undefined) {
      this.root.remove();
    }
    this.root = undefined;
    this.mouthShape = undefined;
    this.mouth = 0;
    this.talkAuto = false;
  }

  private applyClip(): void {
    if (this.root === undefined) {
      return;
    }
    for (const name of CLIP_NAMES) {
      this.root.classList.remove(`clip-${name}`);
    }
    this.root.classList.add(`clip-${this.clip}`);
    if (this.clip === 'talk') {
      this.startTalkAuto();
    } else {
      this.stopTalkAuto();
    }
  }

  private applyFlip(): void {
    if (this.root === undefined) {
      return;
    }
    this.root.classList.toggle('flipped', this.flipped);
  }

  private applyMouth(): void {
    if (this.root === undefined || this.mouthShape === undefined) {
      return;
    }
    const value = this.mouth.toFixed(3);
    this.mouthShape.setAttribute('ry', (1 + this.mouth * 8).toFixed(2));
    this.root.style.setProperty('--mouth', value);
    this.root.dataset.mouth = value;
  }

  private startTalkAuto(): void {
    this.stopTalkAuto();
    this.talkAuto = true;
    this.talkTimer = window.setInterval(() => {
      if (!this.talkAuto) {
        return;
      }
      this.mouth = 0.5 + 0.45 * Math.sin(Date.now() / TALK_TICK_MS);
      this.applyMouth();
    }, TALK_TICK_MS);
  }

  private stopTalkAuto(): void {
    if (this.talkTimer !== undefined) {
      window.clearInterval(this.talkTimer);
      this.talkTimer = undefined;
    }
  }
}
