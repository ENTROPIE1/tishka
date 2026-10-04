import { describe, expect, it } from 'vitest';
import {
  PET_LAYOUT_DEFAULTS,
  petLayout,
  rectWithinAny,
  workAreaForPoint,
  type PetLayout,
  type PetWindowRect,
  type WorkArea
} from '../src/pet/layout';

const { margin, petWidth } = PET_LAYOUT_DEFAULTS;
const screen: WorkArea = { x: 0, y: 0, width: 1920, height: 1020 };

function inside(area: WorkArea, layout: PetLayout): boolean {
  const rect: PetWindowRect = layout.window;
  return (
    rect.x >= area.x &&
    rect.y >= area.y &&
    rect.x + rect.width <= area.x + area.width &&
    rect.y + rect.height <= area.y + area.height
  );
}

describe('границы окна-питомца при перетаскивании', () => {
  it('сто перемещений подряд не меняют размер окна', () => {
    let petX = screen.x + screen.width - margin - petWidth;
    const first = petLayout(screen, petX);
    for (let i = 0; i < 100; i += 1) {
      petX += i % 3 === 0 ? 17 : -23;
      const layout = petLayout(screen, petX);
      expect(layout.window.width).toBe(first.window.width);
      expect(layout.window.height).toBe(first.window.height);
    }
  });

  it('положение левее и правее допустимого прижимается к краю', () => {
    const left = petLayout(screen, -5000);
    expect(left.window.x).toBe(screen.x);
    expect(left.petX).toBe(screen.x + margin);

    const right = petLayout(screen, 5000);
    expect(right.window.x + right.window.width).toBe(screen.x + screen.width);
    expect(right.petX + right.petWidth).toBe(screen.x + screen.width - margin);
  });

  it('окно остаётся в рабочей области при любом положении', () => {
    for (let petX = screen.x - 400; petX <= screen.x + screen.width + 400; petX += 37) {
      expect(inside(screen, petLayout(screen, petX))).toBe(true);
    }
  });

  it('экран с отрицательной координатой начала (слева от основного)', () => {
    const leftScreen: WorkArea = { x: -1920, y: 0, width: 1920, height: 1020 };

    expect(inside(leftScreen, petLayout(leftScreen, -100))).toBe(true);
    expect(petLayout(leftScreen, -99999).window.x).toBe(leftScreen.x);
    const near = petLayout(leftScreen, 99999);
    expect(near.window.x + near.window.width).toBe(leftScreen.x + leftScreen.width);
  });

  it('масштаб 1,25 и 1,5: положение выровнено по физическим пикселям', () => {
    for (const scale of [1.25, 1.5]) {
      const area: WorkArea = { x: 0, y: 0, width: Math.round(1920 / scale), height: Math.round(1020 / scale) };
      const layout = petLayout(area, area.width - 123, { scale });
      const physical = layout.window.x * scale;
      expect(Math.abs(physical - Math.round(physical))).toBeLessThan(1e-6);
      expect(inside(area, layout)).toBe(true);
    }
  });

  it('сохранённое положение вне экранов возвращается в пределы', () => {
    const areas: WorkArea[] = [screen];
    const saved: PetWindowRect = { x: 8000, y: 0, width: 624, height: 1020 };
    expect(rectWithinAny(areas, saved)).toBe(false);

    const area = workAreaForPoint(areas, saved.x, saved.y);
    expect(area).toBe(screen);
    expect(inside(area, petLayout(area, saved.x))).toBe(true);
  });

  it('при нескольких мониторах экран берётся по месту ёжика', () => {
    const left: WorkArea = { x: -1920, y: 0, width: 1920, height: 1020 };
    const primary: WorkArea = { x: 0, y: 0, width: 1920, height: 1020 };

    expect(workAreaForPoint([primary, left], -500, 100)).toBe(left);
    expect(workAreaForPoint([primary, left], 500, 100)).toBe(primary);
    expect(rectWithinAny([primary, left], { x: -900, y: 0, width: 624, height: 1020 })).toBe(true);
  });
});
