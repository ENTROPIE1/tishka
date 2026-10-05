// Размеры персонажа на экране. Источник один: и переходник в окне ежа, и
// раскладка главного процесса берут отсюда. Высота нового персонажа — константа.

import type { Config } from '../core/types';
import { PET_LAYOUT_DEFAULTS, type PetLayoutContent } from './layout';

export type PetCharacterKind = Config['persona']['character'];

export interface PetCharacterSize {
  width: number;
  height: number;
}

// Пропорции костной модели Тишки в единицах модели.
export const TISHKA_MODEL_WIDTH = 520;
export const TISHKA_MODEL_HEIGHT = 1220;

// Высота нового персонажа на экране в точках.
export const PET_TISHKA_HEIGHT = 260;

export const PET_HEDGEHOG_SIZE: PetCharacterSize = {
  width: PET_LAYOUT_DEFAULTS.petWidth,
  height: PET_LAYOUT_DEFAULTS.petHeight
};

export const PET_TISHKA_SIZE: PetCharacterSize = {
  width: Math.round((PET_TISHKA_HEIGHT * TISHKA_MODEL_WIDTH) / TISHKA_MODEL_HEIGHT),
  height: PET_TISHKA_HEIGHT
};

export function petCharacterSize(kind: PetCharacterKind): PetCharacterSize {
  return kind === 'tishka' ? PET_TISHKA_SIZE : PET_HEDGEHOG_SIZE;
}

// Настройки раскладки под выбранного персонажа. Высокий Тишка стоит ногами на
// той же линии; облачко поднимается к мордочке прежнего ежа, а у высокого
// персонажа остаётся внизу и лица не перекрывает.
export function petCharacterContent(kind: PetCharacterKind): PetLayoutContent {
  const size = petCharacterSize(kind);
  return {
    petWidth: size.width,
    petHeight: size.height
  };
}
