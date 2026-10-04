// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { HistoryEntry } from '../src/core/history';
import { createChatFeed } from '../src/renderer/chat/feed';

function message(id: string, text: string, from: 'user' | 'tishka' = 'user'): HistoryEntry {
  return { kind: 'message', id, at: '2026-10-02T10:00:00.000Z', from, text };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('createChatFeed', () => {
  it('рисует разделитель отдельной линией', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const feed = createChatFeed(container);

    feed.refill([
      message('a', 'привет'),
      { kind: 'divider', id: 'd', at: '2026-10-02T10:00:00.000Z' },
      message('b', 'пока', 'tishka')
    ]);

    expect(container.querySelectorAll('.divider')).toHaveLength(1);
    expect(container.querySelector('.divider-label')?.textContent).toContain('Новый разговор');
    expect(container.querySelectorAll('[data-id]')).toHaveLength(3);
  });

  it('scrollTo находит реплику, highlight подсвечивает', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const feed = createChatFeed(container);
    feed.refill([message('a', 'привет')]);

    expect(feed.scrollTo('a')).toBe(true);
    expect(feed.scrollTo('нет-такой')).toBe(false);

    feed.highlight('a');
    expect(container.querySelector('[data-id="a"]')?.classList.contains('flash')).toBe(true);
  });

  it('refill сохраняет открытую карточку ввода с черновиком и фокусом', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const feed = createChatFeed(container);
    feed.appendAskCard({ title: 'Текст для итога' });
    const field = container.querySelector<HTMLTextAreaElement>('.ask-input');
    if (field === null) {
      throw new Error('Поле ввода не найдено');
    }
    field.value = 'черновик ответа';
    field.focus();

    feed.refill([message('a', 'привет')]);

    const again = container.querySelector<HTMLTextAreaElement>('.ask-input');
    expect(again).not.toBeNull();
    expect(again?.value).toBe('черновик ответа');
    expect(document.activeElement).toBe(again);
    expect(container.lastElementChild?.contains(again)).toBe(true);
  });

  it('refill сохраняет карточку «Навык сохранён» в конце ленты', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const feed = createChatFeed(container);
    feed.appendSkillCard('morning');

    feed.refill([message('a', 'привет')]);

    expect(container.querySelectorAll('.msg-system')).toHaveLength(1);
    expect(container.lastElementChild?.textContent).toContain('Навык сохранён');
  });
});
