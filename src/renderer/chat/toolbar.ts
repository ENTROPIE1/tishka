import type { HistoryEntry } from '../../core/history';
import type { ChatFeed } from './feed';
import { createChatSearch } from './search';

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) {
    throw new Error(`Не найден элемент: ${id}`);
  }
  return node as T;
}

export interface ChatToolbarDeps {
  feed: ChatFeed;
  reload: () => Promise<void>;
  loadAll: () => Promise<HistoryEntry[]>;
}

// Шапка чата: поиск по истории и кнопка нового разговора.
export function mountChatToolbar(deps: ChatToolbarDeps): void {
  createChatSearch({
    feed: deps.feed,
    toggle: element('search-toggle'),
    panel: element('search-panel'),
    input: element('search-input'),
    results: element('search-results'),
    loadAll: deps.loadAll
  });
  element<HTMLButtonElement>('new-conversation').addEventListener('click', () => {
    void window.tishka.newConversation().then(deps.reload);
  });
}
