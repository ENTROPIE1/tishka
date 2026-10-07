// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HistoryEntry } from '../src/core/history';
import type { ChatFeed } from '../src/renderer/chat/feed';
import { mountChatToolbar } from '../src/renderer/chat/toolbar';

const feed = {
  scrollTo: () => true,
  refill: () => undefined,
  highlight: () => undefined,
  clear: () => undefined
} as unknown as ChatFeed;

const IDS = ['search-toggle', 'search-panel', 'search-input', 'search-results', 'new-conversation', 'clear-history'];

function mount(): { setStatus: ReturnType<typeof vi.fn>; clearStatus: ReturnType<typeof vi.fn> } {
  for (const id of IDS) {
    const node = id === 'search-input' ? document.createElement('input') : document.createElement('div');
    node.id = id;
    if (id === 'search-panel' || id === 'search-results') {
      node.hidden = true;
    }
    document.body.append(node);
  }
  const setStatus = vi.fn<(text: string) => void>();
  const clearStatus = vi.fn<() => void>();
  mountChatToolbar({
    feed,
    reload: async () => undefined,
    loadAll: async (): Promise<HistoryEntry[]> => [],
    setStatus,
    clearStatus
  });
  return { setStatus, clearStatus };
}

function click(id: string): void {
  document.getElementById(id)?.click();
}

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('mountChatToolbar', () => {
  it('ошибка «Новый разговор» показывается в строке состояния', async () => {
    (window as unknown as { tishka: unknown }).tishka = {
      newConversation: vi.fn(async () => {
        throw new Error('сбой');
      }),
      clearHistory: vi.fn(async () => undefined),
      historySearch: vi.fn(async () => [])
    };
    const { setStatus } = mount();

    click('new-conversation');
    await tick();
    await tick();

    expect(setStatus).toHaveBeenCalledWith('Не удалось начать новый разговор');
  });

  it('ошибка «Очистить историю» показывается в строке состояния', async () => {
    (window as unknown as { tishka: unknown }).tishka = {
      newConversation: vi.fn(async () => undefined),
      clearHistory: vi.fn(async () => {
        throw new Error('сбой');
      }),
      historySearch: vi.fn(async () => [])
    };
    const { setStatus } = mount();

    click('clear-history');
    document.querySelector<HTMLButtonElement>('.app-confirm .button-danger')?.click();
    await tick();
    await tick();

    expect(setStatus).toHaveBeenCalledWith('Не удалось очистить историю');
  });
});
