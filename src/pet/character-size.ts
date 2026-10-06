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

// Ось персонажа по горизонтали в единицах модели: руки уходят далеко от тела.
export const TISHKA_MODEL_AXIS_X = 400;
// Холст шире тела: запас под поднятые руки, до ±440 от оси.
export const TISHKA_CANVAS_WIDTH = 880;
// Запас холста сверху над верхом модели — под эффекты (уведомление и прочее).
export const TISHKA_CANVAS_TOP = 120;
// Ширина ступней в единицах модели: на неё укорачивается строка ввода.
export const TISHKA_FEET_WIDTH = 336;
// Низ ступней в единицах модели: ниже фигура пустая.
export const TISHKA_FEET_BOTTOM = 1184;

// Высота нового персонажа на экране в точках.
export const PET_TISHKA_HEIGHT = 260;

// Перевод единиц модели в точки при высоте фигуры PET_TISHKA_HEIGHT.
function toPoints(units: number): number {
  return Math.round((PET_TISHKA_HEIGHT * units) / TISHKA_MODEL_HEIGHT);
}

export const PET_HEDGEHOG_SIZE: PetCharacterSize = {
  width: PET_LAYOUT_DEFAULTS.petWidth,
  height: PET_LAYOUT_DEFAULTS.petHeight
};

export const PET_TISHKA_SIZE: PetCharacterSize = {
  width: toPoints(TISHKA_MODEL_WIDTH),
  height: PET_TISHKA_HEIGHT
};

// Размеры широкого холста нового персонажа и его посадка на строку ввода.
export const PET_TISHKA_CANVAS_WIDTH = toPoints(TISHKA_CANVAS_WIDTH);
export const PET_TISHKA_CANVAS_HEIGHT = toPoints(TISHKA_MODEL_HEIGHT + TISHKA_CANVAS_TOP);
// Запас по бокам тела под руку — половина лишней ширины холста.
export const PET_TISHKA_ARM_RESERVE = Math.ceil((PET_TISHKA_CANVAS_WIDTH - PET_TISHKA_SIZE.width) / 2);
// Ширина ступней на экране: на неё короче строка ввода.
export const PET_TISHKA_FEET_WIDTH = toPoints(TISHKA_FEET_WIDTH);
// Насколько холст опускается ниже рамки, чтобы ступни встали на строку ввода.
export const PET_TISHKA_STAND = toPoints(TISHKA_MODEL_HEIGHT - TISHKA_FEET_BOTTOM);

export function petCharacterSize(kind: PetCharacterKind): PetCharacterSize {
  return kind === 'tishka' ? PET_TISHKA_SIZE : PET_HEDGEHOG_SIZE;
}

// Настройки раскладки под выбранного персонажа. Высокий Тишка стоит ногами на
// той же линии; его холст шире тела, поэтому окно придерживает запас под руку
// и отдаёт ногам часть строки ввода. Прежний ёж не меняется.
export function petCharacterContent(kind: PetCharacterKind): PetLayoutContent {
  const size = petCharacterSize(kind);
  if (kind === 'tishka') {
    return {
      petWidth: size.width,
      petHeight: size.height,
      petReserve: PET_TISHKA_ARM_RESERVE,
      feet: PET_TISHKA_FEET_WIDTH,
      stand: PET_TISHKA_STAND
    };
  }
  return {
    petWidth: size.width,
    petHeight: size.height
  };
}
