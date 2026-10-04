import type { HistoryEntry, HistoryMessage } from '../../core/history';
import { historyEntryText, normalizeHistoryText } from '../../core/history-search';
import type { ChatFeed } from './feed';

const SEARCH_LIMIT = 50;
const EXCERPT_BEFORE = 40;
const EXCERPT_AFTER = 120;
const AUTHORS: Record<HistoryMessage['from'], string> = {
  user: 'Вы',
  tishka: 'Тишка',
  system: 'Система'
};

export interface ChatSearchOptions {
  feed: ChatFeed;
  toggle: HTMLButtonElement;
  panel: HTMLElement;
  input: HTMLInputElement;
  results: HTMLElement;
  loadAll: () => Promise<HistoryEntry[]>;
}

function dateLabel(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function isMessage(entry: HistoryEntry): entry is HistoryMessage {
  return entry.kind === 'message';
}

// Отрывок вокруг первого совпадения; совпадение подсвечивается, регистр и «ё/е» не важны.
function excerptElement(text: string, query: string): HTMLElement {
  const node = document.createElement('div');
  node.className = 'search-excerpt';
  const normalized = normalizeHistoryText(text);
  const needle = normalizeHistoryText(query.trim());
  const index = needle === '' ? -1 : normalized.indexOf(needle);

  if (index < 0) {
    node.textContent = text.length > 160 ? `${text.slice(0, 160)}…` : text;
    return node;
  }

  const from = Math.max(0, index - EXCERPT_BEFORE);
  const to = Math.min(text.length, index + needle.length + EXCERPT_AFTER);
  if (from > 0) {
    node.append('…');
  }
  node.append(text.slice(from, index));
  const mark = document.createElement('mark');
  mark.textContent = text.slice(index, index + needle.length);
  node.append(mark);
  node.append(`${text.slice(index + needle.length, to)}${to < text.length ? '…' : ''}`);
  return node;
}

export function createChatSearch(options: ChatSearchOptions): void {
  let entries: HistoryMessage[] = [];
  let active = -1;
  let requestId = 0;
  let failed = false;

  function render(): void {
    options.results.replaceChildren();
    if (failed) {
      const note = document.createElement('div');
      note.className = 'search-empty';
      note.textContent = 'Поиск не удался';
      options.results.append(note);
    }
    options.results.hidden = !failed && entries.length === 0;
    for (const [index, entry] of entries.entries()) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'search-result';
      row.dataset['index'] = String(index);

      const head = document.createElement('div');
      head.className = 'search-result-head';
      head.textContent = `${dateLabel(entry.at)} · ${AUTHORS[entry.from]}`;
      row.append(head, excerptElement(historyEntryText(entry), options.input.value));
      row.addEventListener('click', () => {
        void select(index);
      });
      options.results.append(row);
    }
    setActive(-1);
  }

  function setActive(index: number): void {
    active = index;
    options.results.querySelectorAll<HTMLElement>('.search-result').forEach((row, rowIndex) => {
      row.classList.toggle('active', rowIndex === index);
    });
    if (index >= 0) {
      options.results
        .querySelector<HTMLElement>(`.search-result[data-index="${index}"]`)
        ?.scrollIntoView?.({ block: 'nearest' });
    }
  }

  async function select(index: number): Promise<void> {
    const entry = entries[index];
    if (entry === undefined) {
      return;
    }
    if (!options.feed.scrollTo(entry.id)) {
      options.feed.refill(await options.loadAll());
      options.feed.scrollTo(entry.id);
    }
    options.feed.highlight(entry.id);
  }

  async function runSearch(): Promise<void> {
    const query = options.input.value.trim();
    const id = (requestId += 1);
    if (query === '') {
      entries = [];
      failed = false;
      render();
      return;
    }
    try {
      const found = (await window.tishka.historySearch(query, SEARCH_LIMIT)).filter(isMessage);
      if (id !== requestId) {
        return;
      }
      entries = found;
      failed = false;
    } catch {
      if (id !== requestId) {
        return;
      }
      entries = [];
      failed = true;
    }
    render();
  }

  function open(): void {
    options.panel.hidden = false;
    options.input.focus();
    options.input.select();
    void runSearch();
  }

  function close(): void {
    options.panel.hidden = true;
    options.results.hidden = true;
    entries = [];
    failed = false;
    options.results.replaceChildren();
    active = -1;
  }

  function toggle(): void {
    if (options.panel.hidden) {
      open();
    } else {
      close();
    }
  }

  options.toggle.addEventListener('click', toggle);
  options.input.addEventListener('input', () => {
    void runSearch();
  });
  options.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (entries.length === 0) {
        return;
      }
      const step = event.shiftKey ? -1 : 1;
      const next = (active + step + entries.length) % entries.length;
      setActive(next);
      void select(next);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      if (options.panel.hidden) {
        open();
      } else {
        options.input.focus();
      }
      return;
    }
    if (event.key === 'Escape' && !options.panel.hidden) {
      close();
    }
  });
}
