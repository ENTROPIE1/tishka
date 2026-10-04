// Раскладка окна-питомца: ёжик стоит сбоку от колонки ответов, строка ввода —
// в самом низу. Функция чистая: по рабочей области, желаемому месту ёжика и
// размерам частей считает прямоугольник окна и сторону раскладки.

export interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PetLayoutContent {
  columnWidth?: number;
  columnMinWidth?: number;
  petWidth?: number;
  petHeight?: number;
  gap?: number;
  margin?: number;
  composerHeight?: number;
}

export interface PetWindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PetLayout {
  window: PetWindowRect;
  mirrored: boolean;
  columnWidth: number;
  columnX: number;
  petX: number;
  petWidth: number;
  petHeight: number;
  composerHeight: number;
}

// Вид раскладки, который главный процесс передаёт окну: только сторона.
export interface PetLayoutView {
  mirrored: boolean;
}

export const PET_LAYOUT_DEFAULTS = {
  columnWidth: 380,
  columnMinWidth: 260,
  petWidth: 200,
  petHeight: 200,
  gap: 12,
  margin: 16,
  composerHeight: 64
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function petLayout(
  workArea: WorkArea,
  petX: number,
  content: PetLayoutContent = {}
): PetLayout {
  const column = content.columnWidth ?? PET_LAYOUT_DEFAULTS.columnWidth;
  const columnMin = content.columnMinWidth ?? PET_LAYOUT_DEFAULTS.columnMinWidth;
  const petWidth = content.petWidth ?? PET_LAYOUT_DEFAULTS.petWidth;
  const petHeight = content.petHeight ?? PET_LAYOUT_DEFAULTS.petHeight;
  const gap = content.gap ?? PET_LAYOUT_DEFAULTS.gap;
  const margin = content.margin ?? PET_LAYOUT_DEFAULTS.margin;
  const composerHeight = content.composerHeight ?? PET_LAYOUT_DEFAULTS.composerHeight;

  const right = workArea.x + workArea.width;
  const minPetX = workArea.x + margin;
  const maxPetX = right - margin - petWidth;
  const desiredPetX = clamp(petX, minPetX, maxPetX);

  // Колонка сужается до доступной ширины, но не меньше минимума.
  const available = workArea.width - margin * 2 - gap - petWidth;
  const columnWidth = Math.max(columnMin, Math.min(column, available));
  const width = margin + columnWidth + gap + petWidth + margin;

  // Обычная раскладка: колонка слева от ёжика. Если слева не помещается —
  // зеркалим: колонка уходит вправо, ёжик смотрит вправо.
  const normalX = desiredPetX - gap - columnWidth - margin;
  const mirrored = normalX < workArea.x;
  const desiredWindowX = mirrored ? desiredPetX - margin : normalX;

  // Окно целиком держим в рабочей области; на сверхузких экранах минимум
  // колонки важнее и окно может выйти за край.
  const maxWindowX = right - width;
  const x = maxWindowX < workArea.x ? workArea.x : clamp(desiredWindowX, workArea.x, maxWindowX);

  const petLeft = mirrored ? x + margin : x + margin + columnWidth + gap;
  const columnX = mirrored ? x + margin + petWidth + gap : x + margin;

  return {
    window: { x, y: workArea.y, width, height: workArea.height },
    mirrored,
    columnWidth,
    columnX,
    petX: petLeft,
    petWidth,
    petHeight,
    composerHeight
  };
}
