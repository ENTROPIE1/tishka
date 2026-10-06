// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PET_TISHKA_CANVAS_WIDTH, petCharacterContent } from '../src/pet/character-size';
import { PET_LAYOUT_DEFAULTS, defaultPetX, petLayout, type WorkArea } from '../src/pet/layout';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const composerCss = readFileSync(resolve(root, 'src/renderer/pet/composer.css'), 'utf8');
const petCss = readFileSync(resolve(root, 'src/renderer/pet/pet.css'), 'utf8');

function cssBlock(css: string, selector: string): string {
  const match = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? '';
}

const composerBlock = (selector: string): string => cssBlock(composerCss, selector);
const petBlock = (selector: string): string => cssBlock(petCss, selector);

const COMPOSER_GAP = 6;
const CONTROL = 30;
const COMPOSER_PAD = 10;

function pixelValue(block: string, property: string): number {
  const match = block.match(new RegExp(`${property}\\s*:\\s*(-?[\\d.]+)px`));
  if (match === null) {
    throw new Error(`в правиле нет ${property}`);
  }
  return Number(match[1]);
}

// Фиксированные части строки: микрофон, отправка, настройки и промежутки между
// ними. Поле ввода тянется и занимает остаток.
function composerControlsWidth(): number {
  return 3 * CONTROL + 3 * COMPOSER_GAP;
}

// Горизонтальная геометрия глазами DOM: правила CSS применяются к размерам
// раскладки так же, как во flex-контейнере окна. Проверки ловят сдвиг колонки
// в запас под холст и вылет кнопок или холста за окно.
describe('геометрия DOM: запас, холст и строка ввода', () => {
  const tishka = petCharacterContent('tishka');

  it('размеры кнопок строки совпадают с правилами CSS', () => {
    expect(pixelValue(composerBlock('\\.composer'), 'gap')).toBe(COMPOSER_GAP);
    expect(pixelValue(composerBlock('\\.composer-send'), 'width')).toBe(CONTROL);
    expect(pixelValue(composerBlock('\\.mic'), 'width')).toBe(CONTROL);
  });

  it('внешний отступ персонажа забирает запас под холст', () => {
    expect(petBlock('\\.pet-side')).toContain('margin-right: var(--pet-reserve');
    expect(petBlock('\\.pet\\.mirrored \\.pet-side')).toContain('margin-left: var(--pet-reserve');
  });

  it('в зеркальной раскладке свёрнутая строка без отступа расширенной', () => {
    // Правило расширенной строки .pet.mirrored .composer специфичнее
    // .composer.collapsed, поэтому свёрнутая полочка возвращает padding: 0 сама.
    const collapsed = composerBlock('\\.pet\\.mirrored \\.composer\\.collapsed');
    expect(collapsed).toContain('padding: 0');
  });

  it('запас реально сокращает колонку до размера раскладки', () => {
    const margin = PET_LAYOUT_DEFAULTS.margin;
    const rowGap = PET_LAYOUT_DEFAULTS.gap;
    for (const width of [560, 700, 1024, 1920]) {
      const area: WorkArea = { x: 0, y: 0, width, height: 900 };
      const layout = petLayout(area, defaultPetX(area, tishka), tishka);
      const contentWidth = layout.window.width - margin * 2;
      const roomForAnswers = contentWidth - rowGap - layout.petWidth - layout.petReserve;
      expect(roomForAnswers).toBe(layout.columnWidth);
    }
  });

  it('широкий холст целиком внутри окна и экрана в обеих раскладках', () => {
    const area: WorkArea = { x: 0, y: 0, width: 1920, height: 1020 };
    for (const petX of [area.x, 40, 300, 960, 1700, area.width]) {
      const layout = petLayout(area, petX, tishka);
      const center = layout.petX + layout.petWidth / 2;
      const left = center - PET_TISHKA_CANVAS_WIDTH / 2;
      const right = center + PET_TISHKA_CANVAS_WIDTH / 2;
      expect(left).toBeGreaterThanOrEqual(layout.window.x);
      expect(right).toBeLessThanOrEqual(layout.window.x + layout.window.width);
      expect(left).toBeGreaterThanOrEqual(area.x);
      expect(right).toBeLessThanOrEqual(area.x + area.width);
    }
  });

  it('поле, отправка и настройки внутри видимой части в обеих раскладках', () => {
    const margin = PET_LAYOUT_DEFAULTS.margin;
    const area: WorkArea = { x: 0, y: 0, width: 1920, height: 1020 };
    for (const petX of [area.x, 960, area.width]) {
      const layout = petLayout(area, petX, tishka);
      // Строка во всю ширину окна, поле и кнопки уходят из-под ступней
      // внутренним полем со стороны персонажа.
      const hostWidth = layout.window.width - margin * 2;
      const innerWidth = hostWidth - (COMPOSER_PAD + layout.feet) - COMPOSER_PAD;
      expect(innerWidth).toBeGreaterThanOrEqual(composerControlsWidth());
      const hostLeft = layout.window.x + margin;
      expect(hostLeft).toBeGreaterThanOrEqual(layout.window.x);
      expect(hostLeft + hostWidth).toBeLessThanOrEqual(layout.window.x + layout.window.width);
    }
  });

  it('свёрнутая строка остаётся в видимой части в обеих раскладках', () => {
    const margin = PET_LAYOUT_DEFAULTS.margin;
    const area: WorkArea = { x: 0, y: 0, width: 1920, height: 1020 };
    for (const petX of [area.x, 960, area.width]) {
      const layout = petLayout(area, petX, tishka);
      const hostWidth = layout.window.width - margin * 2;
      const hostLeft = layout.window.x + margin;
      const collapsedLeft = layout.mirrored ? hostLeft : hostLeft + hostWidth - layout.petWidth;
      const collapsedRight = collapsedLeft + layout.petWidth;
      expect(collapsedLeft).toBeGreaterThanOrEqual(layout.window.x);
      expect(collapsedRight).toBeLessThanOrEqual(layout.window.x + layout.window.width);
    }
  });

  it('рамка и холст опускаются на посадку: ступни на верхней половине строки', () => {
    // Рамка персонажа уходит вниз на --pet-stand, холст лежит на её нижней
    // границе, строка ввода рисуется под ними.
    expect(petCss).toMatch(/\.character\.rig\s*\{[^}]*margin-bottom:\s*calc\(-1 \* var\(--pet-stand/);
    expect(petCss).toMatch(/\.character \.rig-canvas\s*\{[^}]*bottom:\s*0/);
  });

  it('холст персонажа выше облачка и строки ввода по слоям', () => {
    const zIndex = (block: string): number => {
      const match = block.match(/z-index\s*:\s*(\d+)/);
      return match === null ? 0 : Number(match[1]);
    };
    expect(zIndex(petBlock('\\.character'))).toBeGreaterThan(
      zIndex(composerBlock('\\.composer-host'))
    );
    // Облачко не поднимается над персонажем слоем.
    expect(zIndex(petBlock('\\.bubble'))).toBeLessThan(zIndex(petBlock('\\.character')));
  });
});
