// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HistoryEntry } from '../src/core/history';
import type { ChatFeed } from '../src/renderer/chat/feed';
import { createChatSearch } from '../src/renderer/chat/search';

const feed = {
  scrollTo: () => true,
  refill: () => undefined,
  highlight: () => undefined
} as unknown as ChatFeed;

interface Mounted {
  toggle: HTMLButtonElement;
  input: HTMLInputElement;
  results: HTMLElement;
}

function mount(): Mounted {
  const toggle = document.createElement('button');
  const panel = document.createElement('div');
  panel.hidden = true;
  const input = document.createElement('input');
  const results = document.createElement('div');
  results.hidden = true;
  document.body.append(toggle, panel, input, results);
  createChatSearch({ feed, toggle, panel, input, results, loadAll: async () => [] });
  return { toggle, input, results };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('createChatSearch', () => {
  it('при ошибке поиска показывает строку «Поиск не удался»', async () => {
    (window as unknown as { tishka: unknown }).tishka = {
      historySearch: vi.fn(async (): Promise<HistoryEntry[]> => {
        throw new Error('нет связи');
      })
    };
    const { toggle, input, results } = mount();

    toggle.click();
    input.value = 'запрос';
    input.dispatchEvent(new Event('input'));
    await tick();
    await tick();

    expect(results.textContent).toContain('Поиск не удался');
    expect(results.hidden).toBe(false);
  });
});
