import type { HistoryEntry } from '../../core/history';
import { askCardElement, type AskRequest } from '../shared/ask-card';
import { panelElement } from '../shared/panels';
import { renderMarkdown } from '../shared/markdown';

const STICK_BOTTOM_GAP = 48;
const USER_LINE_LIMIT = 6;
const USER_CHAR_LIMIT = 360;
const HIGHLIGHT_MS = 2000;

export interface ChatFeed {
  appendEntry(entry: HistoryEntry): void;
  appendAskCard(ask: AskRequest): void;
  clear(): void;
  fill(entries: HistoryEntry[]): void;
  refill(entries: HistoryEntry[]): void;
  scrollTo(id: string): boolean;
  highlight(id: string): void;
}

function timeLabel(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function dividerLabel(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) {
    return 'Новый разговор';
  }
  const day = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(date);
  return `Новый разговор · ${day}, ${timeLabel(at)}`;
}

// Длинное сообщение человека сворачивается до шести строк с кнопкой «Показать целиком».
function userTextElement(text: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'msg-user-body';
  const body = document.createElement('div');
  body.className = 'msg-text';
  body.textContent = text;
  wrap.append(body);
  if (text.split('\n').length > USER_LINE_LIMIT || text.length > USER_CHAR_LIMIT) {
    body.classList.add('clamped');
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'msg-expand';
    toggle.textContent = 'Показать целиком';
    toggle.addEventListener('click', () => {
      const clamped = body.classList.toggle('clamped');
      toggle.textContent = clamped ? 'Показать целиком' : 'Свернуть';
    });
    wrap.append(toggle);
  }
  return wrap;
}

function messageElement(entry: HistoryEntry): HTMLElement {
  const message = document.createElement('div');
  message.dataset['id'] = entry.id;

  if (entry.kind === 'divider') {
    message.className = 'divider';
    const line = document.createElement('span');
    line.className = 'divider-label';
    line.textContent = dividerLabel(entry.at);
    message.append(line);
    return message;
  }

  message.className = `msg msg-${entry.from}`;
  if (entry.from === 'tishka' && entry.mood !== undefined) {
    message.classList.add(`mood-${entry.mood}`);
  }

  const content = document.createElement('div');
  content.className = 'msg-content';

  if (entry.from === 'tishka') {
    const text = document.createElement('div');
    text.className = 'msg-text';
    text.innerHTML = renderMarkdown(entry.text);
    content.append(text);
  } else if (entry.from === 'user') {
    content.append(userTextElement(entry.text));
  } else {
    const text = document.createElement('div');
    text.className = 'msg-text';
    text.textContent = entry.text;
    content.append(text);
  }

  if (entry.from === 'tishka' && entry.panel !== undefined) {
    content.append(
      panelElement(entry.panel, {
        onCopy: (text) => {
          void window.tishka.copyText(text);
        },
        onCopyRich: (html, text) => {
          void window.tishka.copyRich(html, text);
        },
        onCopyImage: (path) => {
          void window.tishka.copyImage(path);
        },
        onOpenImage: (path) => {
          void window.tishka.openImage(path);
        }
      })
    );
  }

  const time = document.createElement('div');
  time.className = 'msg-time';
  time.textContent = timeLabel(entry.at);

  message.append(content, time);
  return message;
}

export function createChatFeed(element: HTMLElement): ChatFeed {
  function isPinnedToBottom(): boolean {
    return element.scrollHeight - element.scrollTop - element.clientHeight < STICK_BOTTOM_GAP;
  }

  function scrollToBottom(): void {
    element.scrollTop = element.scrollHeight;
  }

  function appendEntry(entry: HistoryEntry): void {
    const pinned = isPinnedToBottom();
    element.append(messageElement(entry));
    if (pinned) {
      scrollToBottom();
    }
  }

  // Карточка ввода идёт отдельной репликой Тишки и убирается при отмене.
  function appendAskCard(ask: AskRequest): void {
    const pinned = isPinnedToBottom();
    const row = document.createElement('div');
    row.className = 'msg msg-tishka';
    const content = document.createElement('div');
    content.className = 'msg-content';
    content.append(
      askCardElement(ask, {
        onSend: (text) => {
          window.tishka.sendUserText(text);
        },
        onCancel: () => {
          row.remove();
        }
      })
    );
    row.append(content);
    element.append(row);
    if (pinned) {
      scrollToBottom();
    }
  }

  function clear(): void {
    element.replaceChildren();
  }

  function fill(entries: HistoryEntry[]): void {
    for (const entry of entries) {
      element.append(messageElement(entry));
    }
    scrollToBottom();
  }

  function refill(entries: HistoryEntry[]): void {
    clear();
    fill(entries);
  }

  function scrollTo(id: string): boolean {
    const target = element.querySelector<HTMLElement>(`[data-id="${id}"]`);
    if (target === null) {
      return false;
    }
    target.scrollIntoView?.({ block: 'center' });
    return true;
  }

  function highlight(id: string): void {
    const target = element.querySelector<HTMLElement>(`[data-id="${id}"]`);
    if (target === null) {
      return;
    }
    target.classList.add('flash');
    window.setTimeout(() => {
      target.classList.remove('flash');
    }, HIGHLIGHT_MS);
  }

  return { appendEntry, appendAskCard, clear, fill, refill, scrollTo, highlight };
}
