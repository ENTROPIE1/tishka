import type { PetCharacterSize } from '../../pet/character-size';
import type { PetState } from '../../pet/state';

export type ClipName =
  | 'idle'
  | 'walk'
  | 'listen'
  | 'think'
  | 'work'
  | 'talk'
  | 'notify'
  | 'happy'
  | 'confused'
  | 'sleep';

export const CLIP_NAMES: ClipName[] = [
  'idle',
  'walk',
  'listen',
  'think',
  'work',
  'talk',
  'notify',
  'happy',
  'confused',
  'sleep'
];

export interface Character {
  mount(container: HTMLElement): Promise<void>;
  setClip(name: ClipName): void;
  setMouth(level: number): void;
  setFlip(flipped: boolean): void;
  clips(): ClipName[];
  // Пропорции персонажа на экране: раскладка окна ежа учитывает их.
  metrics(): PetCharacterSize;
  dispose(): void;
}

interface ClipState {
  clip: ClipName;
  flip: boolean;
}

const STATE_TO_CLIP: Record<PetState, ClipState> = {
  appear: { clip: 'walk', flip: true },
  leave: { clip: 'walk', flip: false },
  idle: { clip: 'idle', flip: false },
  listening: { clip: 'listen', flip: false },
  thinking: { clip: 'think', flip: false },
  working: { clip: 'work', flip: false },
  talking: { clip: 'talk', flip: false },
  notify: { clip: 'notify', flip: false },
  happy: { clip: 'happy', flip: false },
  confused: { clip: 'confused', flip: false },
  sleep: { clip: 'sleep', flip: false },
  hidden: { clip: 'idle', flip: false }
};

export function clipForState(state: PetState): ClipState {
  return STATE_TO_CLIP[state];
}
