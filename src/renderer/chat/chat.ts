import type { HistoryEntry } from '../../core/history';
import type { Panel } from '../../core/types';
import { renderMarkdown } from './markdown';

const feed = document.getElementById('feed') as HTMLElement;
const statusLine = document.getElementById('status') as HTMLElement;
const input = document.getElementById('input') as HTMLTextAreaElement;
const sendButton = document.getElementById('send') as HTMLButtonElement;
const clearButton = document.getElementById('clear-history') as HTMLButtonElement;
const settingsButton = document.getElementById('open-settings') as HTMLButtonElement;
const bannerButton = document.getElementById('open-settings-banner') as HTMLButtonElement;
const noKeyBanner = document.getElementById('no-key') as HTMLElement;

const STICK_BOTTOM_GAP = 48;
const COPY_FEEDBACK_MS = 1000;

function nowIso(): string {
  return new Date().toISOString();
}

function isPinnedToBottom(): boolean {
  return feed.scrollHeight - feed.scrollTop - feed.clientHeight < STICK_BOTTOM_GAP;
}

function scrollToBottom(): void {
  feed.scrollTop = feed.scrollHeight;
}

function timeLabel(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fileUrl(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  return encodeURI(`file:///${normalized}`);
}

function copyTextForPanel(panel: Panel): string {
  if (panel.kind === 'text') {
    return panel.markdown;
  }
  if (panel.kind === 'list') {
    const lines: string[] = [];
    for (const item of panel.items) {
      lines.push(item.title);
      if (item.subtitle !== undefined) {
        lines.push(item.subtitle);
      }
      if (item.url !== undefined) {
        lines.push(item.url);
      }
    }
    return lines.join('\n');
  }
  return panel.path;
}

function cardElement(panel: Panel): HTMLElement {
  const card = document.createElement('div');
  card.className = 'card';

  const title = document.createElement('div');
  title.className = 'card-title';
  title.textContent = panel.title;
  card.append(title);

  const body = document.createElement('div');
  body.className = 'card-body';
  if (panel.kind === 'text') {
    body.innerHTML = renderMarkdown(panel.markdown);
  } else if (panel.kind === 'list') {
    const list = document.createElement('ul');
    for (const item of panel.items) {
      const itemBox = document.createElement('li');
      const itemTitle = document.createElement('div');
      itemTitle.className = 'item-title';
      itemTitle.textContent = item.title;
      itemBox.append(itemTitle);
      if (item.subtitle !== undefined && item.subtitle !== '') {
        const subtitle = document.createElement('div');
        subtitle.className = 'item-subtitle';
        subtitle.textContent = item.subtitle;
        itemBox.append(subtitle);
      }
      if (item.url !== undefined && item.url !== '') {
        const link = document.createElement('a');
        link.className = 'item-link';
        link.href = item.url;
        link.dataset['url'] = item.url;
        link.textContent = item.url;
        itemBox.append(link);
      }
      list.append(itemBox);
    }
    body.append(list);
  } else {
    const image = document.createElement('img');
    image.className = 'card-image';
    image.src = fileUrl(panel.path);
    image.alt = panel.title;
    body.append(image);
  }
  card.append(body);

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'card-copy';
  copyButton.textContent = 'Копировать';
  copyButton.addEventListener('click', () => {
    void window.tishka.copyText(copyTextForPanel(panel));
    copyButton.textContent = 'Скопировано';
    window.setTimeout(() => {
      copyButton.textContent = 'Копировать';
    }, COPY_FEEDBACK_MS);
  });
  card.append(copyButton);

  return card;
}

function messageElement(entry: HistoryEntry): HTMLElement {
  const message = document.createElement('div');
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
  } else {
    const text = document.createElement('div');
    text.className = 'msg-text';
    text.textContent = entry.text;
    content.append(text);
  }

  if (entry.from === 'tishka' && entry.panel !== undefined) {
    content.append(cardElement(entry.panel));
  }

  const time = document.createElement('div');
  time.className = 'msg-time';
  time.textContent = timeLabel(entry.at);

  message.append(content, time);
  return message;
}

function appendEntry(entry: HistoryEntry): void {
  const pinned = isPinnedToBottom();
  feed.append(messageElement(entry));
  if (pinned) {
    scrollToBottom();
  }
}

function setStatus(text: string): void {
  statusLine.textContent = text;
  statusLine.hidden = false;
}

function clearStatus(): void {
  statusLine.hidden = true;
  statusLine.textContent = '';
}

function send(): void {
  const text = input.value.trim();
  if (text === '') {
    return;
  }
  window.tishka.sendUserText(text);
  input.value = '';
  input.focus();
}

function initEvents(): void {
  window.tishka.onEvent((event) => {
    switch (event.type) {
      case 'listen.end':
        appendEntry({ id: crypto.randomUUID(), at: nowIso(), from: 'user', text: event.text });
        break;
      case 'reply':
        appendEntry({
          id: crypto.randomUUID(),
          at: nowIso(),
          from: 'tishka',
          text: event.reply.say,
          panel: event.reply.show,
          mood: event.reply.mood
        });
        clearStatus();
        break;
      case 'notify':
        appendEntry({ id: crypto.randomUUID(), at: nowIso(), from: 'system', text: event.title });
        break;
      case 'error':
        appendEntry({ id: crypto.randomUUID(), at: nowIso(), from: 'system', text: event.message });
        clearStatus();
        break;
      case 'think.start':
        setStatus('Тишка думает…');
        break;
      case 'tool.start':
        setStatus(`Тишка использует инструмент ${event.tool}`);
        break;
      case 'idle':
        clearStatus();
        break;
      default:
        break;
    }
  });
}

function initFeed(): void {
  feed.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLAnchorElement)) {
      return;
    }
    const url = target.dataset['url'];
    if (url === undefined || url === '') {
      return;
    }
    event.preventDefault();
    void window.tishka.openExternal(url);
  });
}

function initComposer(): void {
  sendButton.addEventListener('click', send);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  });
}

function initClearButton(): void {
  clearButton.addEventListener('click', () => {
    if (!window.confirm('Очистить всю переписку с Тишкой?')) {
      return;
    }
    void window.tishka.clearHistory().then(() => {
      feed.replaceChildren();
      clearStatus();
    });
  });
}

async function loadHistory(): Promise<void> {
  const entries = await window.tishka.history(200);
  for (const entry of entries) {
    feed.append(messageElement(entry));
  }
  scrollToBottom();
}

function initSettingsButtons(): void {
  const open = (): void => {
    void window.tishka.openSettings();
  };
  settingsButton.addEventListener('click', open);
  bannerButton.addEventListener('click', open);
}

async function refreshKeyState(): Promise<void> {
  try {
    const view = await window.tishka.config.get();
    noKeyBanner.hidden = view.gatewayKeySet;
  } catch {
    noKeyBanner.hidden = true;
  }
}

window.addEventListener('focus', () => {
  void refreshKeyState();
});

window.tishka.config.onChanged(() => {
  void refreshKeyState();
});

initEvents();
initFeed();
initComposer();
initClearButton();
initSettingsButtons();
void loadHistory();
void refreshKeyState();
