import type { HistoryEntry } from '../../core/history';
import { askCardElement, type AskRequest } from '../shared/ask-card';
import { messageElement } from './feed-message';

const STICK_BOTTOM_GAP = 48;
const HIGHLIGHT_MS = 2000;

export interface ChatFeed {
  appendEntry(entry: HistoryEntry): void;
  appendAskCard(ask: AskRequest): void;
  appendSkillCard(skillId: string): void;
  clear(): void;
  fill(entries: HistoryEntry[]): void;
  refill(entries: HistoryEntry[]): void;
  scrollTo(id: string): boolean;
  highlight(id: string): void;
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

  // Карточка о сохранённом навыке: ссылка ведёт на экран автоматизаций и подсвечивает карточку.
  function appendSkillCard(skillId: string): void {
    const pinned = isPinnedToBottom();
    const row = document.createElement('div');
    row.className = 'msg msg-system';
    row.dataset['skill'] = skillId;
    const content = document.createElement('div');
    content.className = 'msg-content';
    const text = document.createElement('div');
    text.className = 'msg-text';
    text.textContent = 'Навык сохранён';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'button button-secondary';
    open.textContent = 'Открыть в автоматизациях';
    open.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('tishka:navigate', { detail: { screen: 'automations', skillId } }));
    });
    content.append(text, open);
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

  // Открытая карточка ввода и карточка навыка живут вне истории: при перечитывании
  // ленты они сохраняются на прежних местах вместе с набранным текстом и фокусом.
  function liveRows(): HTMLElement[] {
    return Array.from(element.children).filter((child): child is HTMLElement => {
      if (!(child instanceof HTMLElement)) {
        return false;
      }
      return child.querySelector('.ask-input') !== null || child.dataset['skill'] !== undefined;
    });
  }

  function refill(entries: HistoryEntry[]): void {
    const active = document.activeElement;
    const field = active instanceof HTMLTextAreaElement && active.classList.contains('ask-input') ? active : null;
    const start = field?.selectionStart ?? null;
    const end = field?.selectionEnd ?? null;
    const live = liveRows();
    clear();
    fill(entries);
    for (const row of live) {
      element.append(row);
    }
    if (field !== null && field.isConnected) {
      field.focus();
      if (start !== null && end !== null) {
        field.setSelectionRange(start, end);
      }
    }
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

  return { appendEntry, appendAskCard, appendSkillCard, clear, fill, refill, scrollTo, highlight };
}
