import { screen } from 'electron';
import {
  PET_LAYOUT_DEFAULTS,
  petLayout,
  rectWithinAny,
  workAreaForPoint,
  type PetLayout,
  type PetLayoutContent,
  type PetWindowRect,
  type WorkArea
} from '../pet/layout';

export interface PetGeometry {
  y: number;
  hiddenX: number;
}

function displayAreas(): WorkArea[] {
  return screen.getAllDisplays().map((display) => display.workArea);
}

function defaultPetX(area: WorkArea): number {
  return area.x + area.width - PET_LAYOUT_DEFAULTS.margin - PET_LAYOUT_DEFAULTS.petWidth;
}

// Держит раскладку окна-питомца и экран, на котором он сейчас находится.
// Перемещение меняет только положение: размер берётся из чистой раскладки.
export class PetPlacement {
  layout: PetLayout;
  readonly geometry: PetGeometry;

  constructor(initialPetX: number | null, private readonly content: PetLayoutContent) {
    const area = screen.getPrimaryDisplay().workArea;
    this.layout = petLayout(area, initialPetX ?? defaultPetX(area), content);
    this.geometry = { y: this.layout.window.y, hiddenX: area.x + area.width };
    this.ensureOnScreen();
  }

  bounds(): PetWindowRect {
    return this.layout.window;
  }

  hiddenBounds(): PetWindowRect {
    const { y, width, height } = this.layout.window;
    return { x: this.geometry.hiddenX, y, width, height };
  }

  // Сохранённое положение могло оказаться вне экранов — возвращаем его.
  ensureOnScreen(): void {
    const areas = displayAreas();
    const area = rectWithinAny(areas, this.layout.window)
      ? workAreaForPoint(areas, this.layout.petX, this.layout.window.y)
      : screen.getPrimaryDisplay().workArea;
    this.apply(area, this.layout.petX);
  }

  dragBy(deltaX: number): void {
    const petX = this.layout.petX + deltaX;
    const area = workAreaForPoint(displayAreas(), petX, this.layout.window.y);
    this.apply(area, petX);
  }

  private apply(area: WorkArea, petX: number): void {
    this.layout = petLayout(area, petX, this.content);
    this.geometry.y = this.layout.window.y;
    this.geometry.hiddenX = area.x + area.width;
  }
}
