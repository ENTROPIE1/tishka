import { screen } from 'electron';
import {
  defaultPetX,
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

// Держит раскладку окна-питомца и экран, на котором он сейчас находится.
// Перемещение меняет только положение: размер берётся из чистой раскладки.
export class PetPlacement {
  layout: PetLayout;
  readonly geometry: PetGeometry;
  private area: WorkArea;

  // Содержимое раскладки — функция: смена персонажа меняет размер фигуры
  // без пересоздания окна.
  constructor(initialPetX: number | null, private readonly content: () => PetLayoutContent) {
    const area = screen.getPrimaryDisplay().workArea;
    this.area = area;
    const contentNow = content();
    this.layout = petLayout(area, initialPetX ?? defaultPetX(area, contentNow), contentNow);
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

  // Пересчёт после смены персонажа: место и экран те же, меняются размеры.
  refresh(): void {
    this.apply(this.area, this.layout.petX);
  }

  private apply(area: WorkArea, petX: number): void {
    this.area = area;
    this.layout = petLayout(area, petX, this.content());
    this.geometry.y = this.layout.window.y;
    this.geometry.hiddenX = area.x + area.width;
  }
}
