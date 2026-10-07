import { describe, expect, it } from 'vitest';
import {
  PET_TISHKA_ARM_RESERVE,
  PET_TISHKA_CANVAS_WIDTH,
  PET_TISHKA_FEET_WIDTH,
  PET_TISHKA_STAND,
  petCharacterContent
} from '../../src/pet/character-size';
import { defaultPetX, petLayout, rectWithinAny, type WorkArea } from '../../src/pet/layout';

const SCREEN: WorkArea = { x: 0, y: 0, width: 1920, height: 1040 };

// Окно ежа с новым Тишкой: широкий холст не обрезается краем окна, и само окно
// остаётся на экране при обычной и зеркальной раскладке.
describe('Сценарий: окно ежа с новым Тишкой', () => {
  it('окно целиком на экране, справа от персонажа запас под руку', () => {
    const content = petCharacterContent('tishka');
    const layout = petLayout(SCREEN, defaultPetX(SCREEN, content), content);

    expect(layout.mirrored).toBe(false);
    expect(rectWithinAny([SCREEN], layout.window)).toBe(true);
    const gap = layout.window.x + layout.window.width - (layout.petX + layout.petWidth);
    expect(gap).toBeGreaterThanOrEqual(PET_TISHKA_ARM_RESERVE);
  });

  it('у левого края раскладка зеркальная, запас под руку слева', () => {
    const content = petCharacterContent('tishka');
    const layout = petLayout(SCREEN, SCREEN.x + 16, content);

    expect(layout.mirrored).toBe(true);
    expect(rectWithinAny([SCREEN], layout.window)).toBe(true);
    expect(layout.petX - layout.window.x).toBeGreaterThanOrEqual(PET_TISHKA_ARM_RESERVE);
  });

  it('широкий холст не обрезается краем окна в обеих раскладках', () => {
    const content = petCharacterContent('tishka');
    for (const petX of [SCREEN.x + 16, SCREEN.width / 2, SCREEN.width]) {
      const layout = petLayout(SCREEN, petX, content);
      const axis = layout.petX + layout.petWidth / 2;
      const left = axis - PET_TISHKA_CANVAS_WIDTH / 2;
      const right = axis + PET_TISHKA_CANVAS_WIDTH / 2;
      expect(left).toBeGreaterThanOrEqual(layout.window.x);
      expect(right).toBeLessThanOrEqual(layout.window.x + layout.window.width);
    }
  });

  it('персонаж стоит на строке ввода, а не висит над ней', () => {
    const content = petCharacterContent('tishka');
    for (const petX of [SCREEN.x + 16, SCREEN.width]) {
      const layout = petLayout(SCREEN, petX, content);

      // Посадка на верхнюю кромку строки, не на её низ (раньше 48 точек
      // утаскивали ступни ниже рамки).
      expect(layout.stand).toBe(PET_TISHKA_STAND);
      expect(layout.stand).toBeGreaterThanOrEqual(12);
      expect(layout.stand).toBeLessThan(40);
      // Поле строки уводится из-под ступней внутренним полем на их ширину,
      // окно остаётся целиком на экране.
      expect(layout.feet).toBe(PET_TISHKA_FEET_WIDTH);
      expect(layout.window.width - layout.feet).toBeGreaterThan(3 * 30 + 6 * 3);
      expect(rectWithinAny([SCREEN], layout.window)).toBe(true);
    }
  });
});
