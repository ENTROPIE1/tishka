import { describe, expect, it } from 'vitest';
import { PET_LAYOUT_DEFAULTS, petLayout, type WorkArea } from '../src/pet/layout';

const { margin, petWidth, columnWidth: desiredColumn, columnMinWidth, composerHeight } = PET_LAYOUT_DEFAULTS;

function defaultPetX(workArea: WorkArea): number {
  return workArea.x + workArea.width - margin - petWidth;
}

describe('petLayout', () => {
  const screen: WorkArea = { x: 0, y: 0, width: 1920, height: 1020 };

  it('обычный экран: колонка слева, ёжик справа, окно целиком в рабочей области', () => {
    const layout = petLayout(screen, defaultPetX(screen));

    expect(layout.mirrored).toBe(false);
    expect(layout.columnWidth).toBe(desiredColumn);
    expect(layout.columnX).toBeLessThan(layout.petX);
    expect(layout.window.x).toBeGreaterThanOrEqual(screen.x);
    expect(layout.window.x + layout.window.width).toBeLessThanOrEqual(screen.x + screen.width);
    expect(layout.composerHeight).toBe(composerHeight);
  });

  it('ёжик у левого края — раскладка зеркальная, колонка справа', () => {
    const layout = petLayout(screen, screen.x + margin);

    expect(layout.mirrored).toBe(true);
    expect(layout.columnX).toBeGreaterThan(layout.petX);
    expect(layout.window.x + layout.window.width).toBeLessThanOrEqual(screen.x + screen.width);
  });

  it('узкая рабочая область сужает колонку, но не меньше 260 px', () => {
    const narrow: WorkArea = { x: 0, y: 0, width: 600, height: 800 };
    const layout = petLayout(narrow, defaultPetX(narrow));

    expect(layout.columnWidth).toBeLessThan(desiredColumn);
    expect(layout.columnWidth).toBeGreaterThanOrEqual(columnMinWidth);
  });

  it('на сверхузкой рабочей области колонка остаётся 260 px', () => {
    const tiny: WorkArea = { x: 0, y: 0, width: 400, height: 800 };
    expect(petLayout(tiny, defaultPetX(tiny)).columnWidth).toBe(columnMinWidth);
  });

  it('правый край окна не выходит за рабочую область при любом месте ёжика', () => {
    const right = screen.x + screen.width;
    for (let petX = screen.x; petX <= right; petX += 40) {
      const layout = petLayout(screen, petX);
      expect(layout.window.x).toBeGreaterThanOrEqual(screen.x);
      expect(layout.window.x + layout.window.width).toBeLessThanOrEqual(right);
    }
  });
});
