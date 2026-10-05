import { describe, expect, it } from 'vitest';
import { petCharacterContent, PET_TISHKA_HEIGHT, PET_TISHKA_SIZE } from '../src/pet/character-size';
import { defaultPetX, PET_LAYOUT_DEFAULTS, petLayout, type WorkArea } from '../src/pet/layout';

const { margin, petWidth, columnWidth: desiredColumn, columnMinWidth, composerHeight } = PET_LAYOUT_DEFAULTS;

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

  it('место по умолчанию — справа, с местом слева под облачко и карточку', () => {
    const petX = defaultPetX(screen);
    expect(petX).toBe(screen.x + screen.width - margin - petWidth);

    const layout = petLayout(screen, petX);
    expect(layout.mirrored).toBe(false);
    expect(layout.columnX).toBeLessThan(layout.petX);
    expect(layout.window.x).toBeGreaterThanOrEqual(screen.x);
    expect(layout.window.x + layout.window.width).toBeLessThanOrEqual(screen.x + screen.width);
    expect(layout.petX + layout.petWidth).toBe(screen.x + screen.width - margin);
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

describe('petLayout с высоким персонажем', () => {
  const screen: WorkArea = { x: 0, y: 0, width: 1920, height: 1020 };

  it('размер Тишки — по высоте-константе и пропорциям модели', () => {
    const content = petCharacterContent('tishka');
    expect(content.petHeight).toBe(PET_TISHKA_HEIGHT);
    expect(content.petWidth).toBe(PET_TISHKA_SIZE.width);
    expect(content.petWidth).toBeLessThan(content.petHeight ?? 0);
  });

  it('окно с высоким персонажем целиком помещается на экране', () => {
    const content = petCharacterContent('tishka');
    const layout = petLayout(screen, defaultPetX(screen, content), content);

    expect(layout.petHeight).toBe(PET_TISHKA_HEIGHT);
    expect(layout.window.x).toBeGreaterThanOrEqual(screen.x);
    expect(layout.window.x + layout.window.width).toBeLessThanOrEqual(screen.x + screen.width);
  });

  it('облачко остаётся ниже лица высокого персонажа', () => {
    const content = petCharacterContent('tishka');
    const layout = petLayout(screen, defaultPetX(screen, content), content);
    // Мордочка высокого Тишки — в верхней части фигуры: линия облачка ниже.
    expect(layout.muzzle).toBeLessThan(layout.petHeight / 2);
  });

  it('смена персонажа меняет ширину окна, но не его высоту (экран)', () => {
    const hedgehog = petLayout(screen, defaultPetX(screen), petCharacterContent('hedgehog'));
    const tishka = petLayout(screen, defaultPetX(screen, petCharacterContent('tishka')), petCharacterContent('tishka'));

    expect(tishka.window.width).toBeLessThan(hedgehog.window.width);
    expect(tishka.window.height).toBe(hedgehog.window.height);
  });
});
