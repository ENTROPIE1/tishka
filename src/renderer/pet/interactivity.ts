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

// Прозрачность холста: true — под точкой видимый пиксель персонажа, окно ловит
// мышь; false — пиксель прозрачный, щелчок проходит к тому, что ниже по слоям.
export type PixelOpaque = (canvas: HTMLCanvasElement, x: number, y: number) => boolean;

// Минимальная непрозрачность пикселя, которая считается попаданием: слабые
// полупрозрачные края не должны ловить мышь.
export const OPAQUE_ALPHA = 8;

export interface HitTestOptions {
  // Широкий холст нового персонажа. Сам холст мышь не ловит (pointer-events:
  // none), поэтому его непрозрачность проверяется здесь по точке курсора.
  canvas?: HTMLCanvasElement | null;
  opaque?: PixelOpaque;
}

// Кнопки и поля строки ввода должны получать свой pointerdown даже когда
// широкий холст Тишки визуально лежит поверх них.
export function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('button, input, textarea, select, a') !== null;
}

function inRegions(regions: Element[], element: Element): boolean {
  return regions.some((region) => region.contains(element));
}

function pointInCanvas(canvas: HTMLCanvasElement, x: number, y: number): boolean {
  const rect = canvas.getBoundingClientRect();
  return (
    x >= rect.left &&
    x <= rect.left + rect.width &&
    y >= rect.top &&
    y <= rect.top + rect.height
  );
}

// Находится ли точка над самим персонажем, облачком, карточкой или строкой
// ввода. Для холста нового персонажа попадание считается по непрозрачности
// пикселя: прозрачные места холста (вокруг рук, между ног) мышь не ловят и
// пропускают щелчок к тому, что под ними, — как у прежнего ежа.
export function hitTestRegions(
  regions: Element[],
  x: number,
  y: number,
  options: HitTestOptions = {}
): boolean {
  const { canvas, opaque } = options;
  if (canvas != null && opaque !== undefined && pointInCanvas(canvas, x, y) && opaque(canvas, x, y)) {
    return true;
  }
  const element =
    typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null;
  return element === null ? false : inRegions(regions, element);
}

// Пиксель холста в точке экрана. Учитывает отражение холста и плотность
// пикселей: холст растянут по CSS-размеру, а рисуется в пикселях устройства.
export function canvasPixelOpaque(canvas: HTMLCanvasElement, x: number, y: number): boolean {
  const context = canvas.getContext('2d');
  if (context === null) {
    return false;
  }
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return false;
  }
  let localX = x - rect.left;
  const localY = y - rect.top;
  if (canvas.style.transform.includes('scaleX(-1)')) {
    localX = rect.width - localX;
  }
  const px = Math.floor((localX * canvas.width) / rect.width);
  const py = Math.floor((localY * canvas.height) / rect.height);
  if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) {
    return false;
  }
  return context.getImageData(px, py, 1, 1).data[3] > OPAQUE_ALPHA;
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
