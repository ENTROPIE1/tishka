// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Panel } from '../src/core/types';
import type { PetModel } from '../src/pet/state';
import { createPetCard } from '../src/renderer/pet/pet-card';

const PANEL: Panel = { kind: 'text', title: 'Итог', markdown: 'готово' };

afterEach(() => {
  document.body.replaceChildren();
});

function makeModel(replies: number): PetModel {
  return { state: 'talking', since: 0, queue: [], panel: PANEL, replies };
}

function closeButton(host: HTMLElement): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>('.card-close');
  if (button === null) {
    throw new Error('Кнопка закрытия не найдена');
  }
  return button;
}

describe('createPetCard', () => {
  it('новый ответ с такой же карточкой показывается после закрытия прежней', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const card = createPetCard({ element: host, refreshBusy: vi.fn() });

    card.render(makeModel(1));
    closeButton(host).click();
    expect(host.hidden).toBe(true);

    card.render(makeModel(2));

    expect(host.hidden).toBe(false);
  });

  it('перерисовка без нового ответа закрытую карточку не возвращает', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const card = createPetCard({ element: host, refreshBusy: vi.fn() });

    card.render(makeModel(1));
    closeButton(host).click();
    expect(host.hidden).toBe(true);

    card.render(makeModel(1));

    expect(host.hidden).toBe(true);
  });
});
