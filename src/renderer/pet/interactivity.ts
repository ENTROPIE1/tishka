export interface InteractivePoint {
  x: number;
  y: number;
}

export interface InteractivityDeps {
  isVisible(): boolean;
  hitTest(x: number, y: number): boolean;
  setInteractive(value: boolean): void;
}

export interface Interactivity {
  set(value: boolean): void;
  recalc(point: InteractivePoint): void;
}

// Находится ли точка над ёжиком, облачком, карточкой или строкой ввода.
export function hitTestRegions(regions: Element[], x: number, y: number): boolean {
  const element = document.elementFromPoint(x, y);
  if (element === null) {
    return false;
  }
  return regions.some((region) => region.contains(element));
}

// Единственное место, решающее, ловит ли окно мышь. Пересчёт по положению
// курсора вызывается при показе, смене раскладки и перезагрузке окна.
export function createInteractivity(deps: InteractivityDeps): Interactivity {
  let interactive = false;

  function set(value: boolean): void {
    if (value === interactive) {
      return;
    }
    interactive = value;
    deps.setInteractive(value);
  }

  return {
    set,
    recalc(point): void {
      if (!deps.isVisible()) {
        set(false);
        return;
      }
      set(deps.hitTest(point.x, point.y));
    }
  };
}
