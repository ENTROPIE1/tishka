import type { HistoryEntry } from '../../core/history';
import { panelElement } from '../shared/panels';
import { renderMarkdown } from '../shared/markdown';

const USER_LINE_LIMIT = 6;
const USER_CHAR_LIMIT = 360;

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

export function messageElement(entry: HistoryEntry): HTMLElement {
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

  // Снимок экрана — отдельная строка ленты: уменьшенная картинка над ответом,
  // щелчок открывает файл в полном размере.
  if (entry.kind === 'screenshot') {
    message.className = 'msg msg-tishka';
    const content = document.createElement('div');
    content.className = 'msg-content';
    content.append(
      panelElement(
        { kind: 'image', title: entry.title, path: entry.path },
        {
          onCopyImage: (path) => {
            void window.tishka.copyImage(path);
          },
          onOpenImage: (path) => {
            void window.tishka.openImage(path);
          }
        }
      )
    );
    const shotTime = document.createElement('div');
    shotTime.className = 'msg-time';
    shotTime.textContent = timeLabel(entry.at);
    message.append(content, shotTime);
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
