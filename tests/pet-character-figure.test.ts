// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  PET_COMPOSER_HEIGHT,
  PET_HEDGEHOG_SIZE,
  PET_TISHKA_ARM_RESERVE,
  PET_TISHKA_CANVAS_HEIGHT,
  PET_TISHKA_CANVAS_WIDTH,
  PET_TISHKA_FEET_WIDTH,
  PET_TISHKA_HEIGHT,
  PET_TISHKA_SIZE,
  PET_TISHKA_STAND,
  TISHKA_CANVAS_WIDTH,
  TISHKA_FEET_BOTTOM,
  TISHKA_MODEL_HEIGHT,
  petCharacterContent,
  petCharacterSize
} from '../src/pet/character-size';
import { PET_LAYOUT_DEFAULTS, defaultPetX, petLayout, type WorkArea } from '../src/pet/layout';
import { applyPetLayout } from '../src/renderer/pet/layout-view';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const composerCss = readFileSync(resolve(root, 'src/renderer/pet/composer.css'), 'utf8');
const screen: WorkArea = { x: 0, y: 0, width: 1920, height: 1020 };

function cssBlock(selector: string): string {
  const match = composerCss.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? '';
}

describe('размеры холста нового Тишки', () => {
  it('холст шире тела и покрывает ±440 единиц модели', () => {
    expect(PET_TISHKA_CANVAS_WIDTH).toBe(
      Math.round((PET_TISHKA_HEIGHT * TISHKA_CANVAS_WIDTH) / TISHKA_MODEL_HEIGHT)
    );
    expect(PET_TISHKA_CANVAS_WIDTH).toBeGreaterThan(PET_TISHKA_SIZE.width);
    expect(PET_TISHKA_ARM_RESERVE).toBeGreaterThanOrEqual(
      Math.floor((PET_TISHKA_CANVAS_WIDTH - PET_TISHKA_SIZE.width) / 2)
    );
  });

  it('фигура остаётся 260 точек, сверху запас под эффекты', () => {
    expect(PET_TISHKA_SIZE.height).toBe(PET_TISHKA_HEIGHT);
    expect(PET_TISHKA_CANVAS_HEIGHT).toBeGreaterThan(PET_TISHKA_HEIGHT);
  });

  it('ширина ступней берётся из константы и меньше тела', () => {
    expect(PET_TISHKA_FEET_WIDTH).toBeGreaterThan(0);
    expect(PET_TISHKA_FEET_WIDTH).toBeLessThan(PET_TISHKA_SIZE.width);
  });

  it('посадка не меньше высоты строки, ступни ложатся на её верхнюю половину', () => {
    expect(PET_TISHKA_STAND).toBeGreaterThan(8);
    expect(PET_TISHKA_STAND).toBeLessThan(PET_COMPOSER_HEIGHT);
    // Рамка уходит на посадку с вычетом подписи под персонажем (16 точек и
    // промежуток 2), под ступнями в модели остаётся пустота: глубина ступней
    // на строке = посадка - 18 - пустота модели под ступнями.
    const underFeet = Math.round(
      (PET_TISHKA_HEIGHT * (TISHKA_MODEL_HEIGHT - TISHKA_FEET_BOTTOM)) / TISHKA_MODEL_HEIGHT
    );
    const feetDepth = PET_TISHKA_STAND - 18 - underFeet;
    expect(feetDepth).toBeGreaterThan(0);
    // Верхняя половина строки: поля 8 и 10, кнопки 30 и рамка 2 — около 50 точек.
    expect(feetDepth).toBeLessThanOrEqual((PET_COMPOSER_HEIGHT + 2) / 2);
  });
});

describe('раскладка окна с широким холстом', () => {
  it('справа от персонажа — запас под руку, окно в экране', () => {
    const content = petCharacterContent('tishka');
    const layout = petLayout(screen, defaultPetX(screen, content), content);

    expect(layout.mirrored).toBe(false);
    expect(layout.petReserve).toBe(PET_TISHKA_ARM_RESERVE);
    const rightGap = layout.window.x + layout.window.width - (layout.petX + layout.petWidth);
    expect(rightGap).toBeGreaterThanOrEqual(PET_TISHKA_ARM_RESERVE);
    expect(layout.window.x + layout.window.width).toBeLessThanOrEqual(screen.width);
  });

  it('в зеркальной раскладке запас слева', () => {
    const content = petCharacterContent('tishka');
    const layout = petLayout(screen, screen.x + PET_LAYOUT_DEFAULTS.margin, content);

    expect(layout.mirrored).toBe(true);
    const leftGap = layout.petX - layout.window.x;
    expect(leftGap).toBeGreaterThanOrEqual(PET_TISHKA_ARM_RESERVE);
    expect(layout.window.x).toBeGreaterThanOrEqual(screen.x);
  });

  it('поле строки уводится на ширину ступней, кнопки помещаются', () => {
    const content = petCharacterContent('tishka');
    const layout = petLayout(screen, defaultPetX(screen, content), content);

    expect(layout.feet).toBe(PET_TISHKA_FEET_WIDTH);
    // Строка во всю ширину окна, поле и кнопки уходят из-под ступней
    // внутренним полем строки.
    const visible = layout.window.width - layout.feet;
    expect(visible).toBeGreaterThan(PET_LAYOUT_DEFAULTS.columnMinWidth);
    // Поле и обе кнопки (микрофон, отправка, настройки) помещаются.
    expect(visible).toBeGreaterThan(3 * 30 + 6 * 3);
  });
});

describe('прежний ёж не меняется', () => {
  it('размеры и раскладка такие же, как по умолчанию', () => {
    expect(petCharacterSize('hedgehog')).toEqual(PET_HEDGEHOG_SIZE);
    const content = petCharacterContent('hedgehog');
    expect(content).toEqual({
      petWidth: PET_LAYOUT_DEFAULTS.petWidth,
      petHeight: PET_LAYOUT_DEFAULTS.petHeight
    });

    const withContent = petLayout(screen, defaultPetX(screen, content), content);
    const byDefault = petLayout(screen, defaultPetX(screen));
    expect(withContent.window).toEqual(byDefault.window);
    expect(withContent.petX).toBe(byDefault.petX);
    expect(withContent.feet).toBe(0);
    expect(withContent.petReserve).toBe(0);
  });
});

describe('вид раскладки в окне', () => {
  it('applyPetLayout отдаёт запас, ступни и посадку переменными', () => {
    const element = document.createElement('div');
    applyPetLayout(element, { mirrored: true, petReserve: 39, feet: 72, stand: 8 });

    expect(element.style.getPropertyValue('--pet-reserve')).toBe('39px');
    expect(element.style.getPropertyValue('--pet-feet')).toBe('72px');
    expect(element.style.getPropertyValue('--pet-stand')).toBe('8px');
    expect(element.classList.contains('mirrored')).toBe(true);
  });
});

describe('строка ввода и ступни', () => {
  it('строка во всю ширину окна, без урезания на ширину ступней', () => {
    const host = cssBlock('\\.composer-host');
    expect(host).not.toBe('');
    expect(host).not.toContain('calc(100% -');
    expect(host).not.toContain('var(--pet-feet');
    expect(composerCss).not.toContain('.pet.mirrored .composer-host');
  });

  it('внутреннее поле строки без запаса под ступни — кнопки у края, персонаж стоит на рамке', () => {
    expect(cssBlock('\\.composer')).not.toContain('var(--pet-feet');
    expect(cssBlock('\\.pet\\.mirrored \\.composer')).not.toContain('var(--pet-feet');
  });
});
