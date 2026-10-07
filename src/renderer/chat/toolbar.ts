import type { HistoryEntry } from '../../core/history';
import { askConfirm } from '../shared/app-confirm';
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
  setStatus: (text: string) => void;
  clearStatus: () => void;
}

// Шапка чата: поиск по истории, новый разговор и очистка истории.
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
    void window.tishka
      .newConversation()
      .then(deps.reload)
      .catch(() => {
        deps.setStatus('Не удалось начать новый разговор');
      });
  });
  element<HTMLButtonElement>('clear-history').addEventListener('click', () => {
    void (async () => {
      if (!(await askConfirm('Очистить всю переписку с Тишкой?'))) {
        return;
      }
      try {
        await window.tishka.clearHistory();
        deps.feed.clear();
        deps.clearStatus();
      } catch {
        deps.setStatus('Не удалось очистить историю');
      }
    })();
  });
}
