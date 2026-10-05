// Раскладка окна-питомца: ёжик стоит сбоку от колонки ответов, строка ввода —
// в самом низу. Функция чистая: по рабочей области, желаемому месту ёжика и
// размерам частей считает прямоугольник окна и сторону раскладки.
// Положение ёжика не влияет на размер окна: перемещение меняет только место.

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
  // Высота мордочки персонажа над нижним краем: до этой линии поднимаются
  // облачко и карточка, чтобы не перекрывать лицо.
  muzzle?: number;
  // Масштаб экрана (1, 1.25, 1.5 …). Положение окна округляется до целого
  // числа физических пикселей, чтобы при перемещении оно не «плыло».
  scale?: number;
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
  muzzle: number;
  composerHeight: number;
}

// Вид раскладки, который главный процесс передаёт окну: сторона и размеры
// персонажа. Размеры — необязательные, старые вызовы задают только сторону.
export interface PetLayoutView {
  mirrored: boolean;
  petWidth?: number;
  petHeight?: number;
  muzzle?: number;
}

export const PET_LAYOUT_DEFAULTS = {
  columnWidth: 380,
  columnMinWidth: 260,
  petWidth: 200,
  petHeight: 200,
  gap: 12,
  margin: 16,
  composerHeight: 64,
  muzzle: 72
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function snap(value: number, scale: number): number {
  if (scale <= 0 || scale === 1) {
    return Math.round(value);
  }
  return Math.round(value * scale) / scale;
}

// Экран, на котором находится точка: содержащий её, иначе ближайший.
export function workAreaForPoint(workAreas: WorkArea[], x: number, y: number): WorkArea {
  if (workAreas.length === 0) {
    throw new Error('нет доступных экранов');
  }
  for (const area of workAreas) {
    const insideX = x >= area.x && x <= area.x + area.width;
    const insideY = y >= area.y && y <= area.y + area.height;
    if (insideX && insideY) {
      return area;
    }
  }
  let best = workAreas[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const area of workAreas) {
    const dx = Math.max(area.x - x, 0, x - (area.x + area.width));
    const dy = Math.max(area.y - y, 0, y - (area.y + area.height));
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = area;
    }
  }
  return best;
}

// Полностью ли прямоугольник лежит в одном из экранов.
export function rectWithinAny(workAreas: WorkArea[], rect: PetWindowRect): boolean {
  return workAreas.some(
    (area) =>
      rect.x >= area.x &&
      rect.y >= area.y &&
      rect.x + rect.width <= area.x + area.width &&
      rect.y + rect.height <= area.y + area.height
  );
}

// Место по умолчанию: правый нижний угол рабочей области с отступом, так чтобы
// слева от ёжика помещались облачко с репликой и карточка.
export function defaultPetX(workArea: WorkArea, content: PetLayoutContent = {}): number {
  const petWidth = content.petWidth ?? PET_LAYOUT_DEFAULTS.petWidth;
  const margin = content.margin ?? PET_LAYOUT_DEFAULTS.margin;
  return workArea.x + workArea.width - margin - petWidth;
}

// Положение ёжика, при котором он остаётся в пределах рабочей области.
export function clampPetX(workArea: WorkArea, petX: number, content: PetLayoutContent = {}): number {
  const petWidth = content.petWidth ?? PET_LAYOUT_DEFAULTS.petWidth;
  const margin = content.margin ?? PET_LAYOUT_DEFAULTS.margin;
  const min = workArea.x + margin;
  const max = workArea.x + workArea.width - margin - petWidth;
  return max < min ? min : clamp(petX, min, max);
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
  const muzzle = content.muzzle ?? PET_LAYOUT_DEFAULTS.muzzle;
  const scale = content.scale ?? 1;

  const right = workArea.x + workArea.width;
  const desiredPetX = clampPetX(workArea, petX, content);

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
  let x: number;
  if (maxWindowX < workArea.x) {
    x = workArea.x;
  } else {
    const minX = Math.ceil(workArea.x * scale) / scale;
    const maxX = Math.floor(maxWindowX * scale) / scale;
    x = maxX < minX ? workArea.x : clamp(snap(desiredWindowX, scale), minX, maxX);
  }

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
    muzzle,
    composerHeight
  };
}
