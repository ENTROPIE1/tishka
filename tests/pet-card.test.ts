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

function stubApi(): { confirm: ReturnType<typeof vi.fn> } {
  const confirm = vi.fn();
  (window as unknown as { tishka: unknown }).tishka = {
    pet: { focus: vi.fn() },
    confirm
  };
  return { confirm };
}

describe('createPetCard: подтверждение', () => {
  it('показывает вопрос с кнопками «Да» и «Нет»', () => {
    const host = document.createElement('div');
    document.body.append(host);
    stubApi();
    const card = createPetCard({ element: host, refreshBusy: vi.fn() });

    card.render({ state: 'working', since: 0, queue: [], confirm: { id: 'c1', text: 'Выполнить через jira?' } });

    expect(host.hidden).toBe(false);
    expect(host.querySelector('.confirm-text')?.textContent).toBe('Выполнить через jira?');
    expect(host.querySelector('.confirm-yes')?.textContent).toBe('Да');
    expect(host.querySelector('.confirm-no')?.textContent).toBe('Нет');
  });

  it('«Да» отправляет ответ с идентификатором вопроса', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const api = stubApi();
    const card = createPetCard({ element: host, refreshBusy: vi.fn() });

    card.render({ state: 'working', since: 0, queue: [], confirm: { id: 'c9', text: '?' } });
    (host.querySelector('.confirm-yes') as HTMLButtonElement).click();

    expect(api.confirm).toHaveBeenCalledWith('c9', true);
  });
});

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
