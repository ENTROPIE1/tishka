import type { Panel } from '../../core/types';
import { markdownToPlain, renderMarkdown } from './markdown';

const COPY_FEEDBACK_MS = 1000;
const COPY_ERROR_MS = 2000;

export interface PanelActions {
  onCopy?: (text: string) => void | Promise<void>;
  onCopyRich?: (html: string, text: string) => void | Promise<void>;   // текстовая карточка: html и чистый текст сразу
  onCopyImage?: (path: string) => void | Promise<void>;                // карточка-картинка: в буфер идёт сама картинка
  onOpenImage?: (path: string) => void | Promise<void>;                // щелчок по картинке открывает её в просмотрщике
  onOpenChat?: () => void;
  onClose?: () => void;
}

function fileUrl(path: string): string {
  const segments = path.replace(/\\/g, '/').replace(/^\/+/, '').split('/');
  const encoded = segments.map((part, index) =>
    index === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part));
  return `file:///${encoded.join('/')}`;
}

export function copyTextForPanel(panel: Panel): string {
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

function plainCopyText(panel: Panel): string {
  return panel.kind === 'text' ? markdownToPlain(panel.markdown) : copyTextForPanel(panel);
}

// Копирует карточку: сначала с оформлением, при сбое — чистым текстом.
// Бросает ошибку, если не удалось ни то, ни другое.
async function performCopy(actions: PanelActions, panel: Panel): Promise<void> {
  if (panel.kind === 'image') {
    const copyImage = actions.onCopyImage;
    if (copyImage !== undefined) {
      await copyImage(panel.path);
      return;
    }
  }
  const rich = actions.onCopyRich;
  if (panel.kind === 'text' && rich !== undefined) {
    try {
      await rich(renderMarkdown(panel.markdown), markdownToPlain(panel.markdown));
      return;
    } catch {
      // Оформление не прошло — пробуем чистый текст ниже.
    }
  }
  const plain = actions.onCopy;
  if (plain === undefined) {
    throw new Error('Не удалось скопировать');
  }
  await plain(plainCopyText(panel));
}

function showCopyResult(button: HTMLButtonElement, text: string, timeout: number): void {
  button.textContent = text;
  window.setTimeout(() => {
    button.textContent = 'Копировать';
  }, timeout);
}

function panelBody(panel: Panel, actions: PanelActions): HTMLElement {
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
    // Файл мог быть удалён пределом числа снимков: вместо битой картинки — тихая строка.
    image.addEventListener('error', () => {
      const missing = document.createElement('div');
      missing.className = 'card-image-missing';
      missing.textContent = 'Снимок экрана удалён';
      body.replaceChildren(missing);
    });
    if (actions.onOpenImage !== undefined) {
      const open = actions.onOpenImage;
      image.classList.add('card-image-open');
      image.addEventListener('click', () => {
        void open(panel.path);
      });
    }
    body.append(image);
  }
  return body;
}

// Карточка панели одинакова в чате и в окне-питомце, различаются только кнопки.
// Шапка с заголовком и закрытием, прокручиваемая середина и нижняя строка с кнопками.
export function panelElement(panel: Panel, actions: PanelActions = {}): HTMLElement {
  const card = document.createElement('div');
  card.className = 'card';

  const head = document.createElement('div');
  head.className = 'card-head';

  const title = document.createElement('div');
  title.className = 'card-title';
  title.textContent = panel.title;
  head.append(title);

  if (actions.onClose !== undefined) {
    const close = actions.onClose;
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'card-close';
    closeButton.textContent = '×';
    closeButton.setAttribute('aria-label', 'Закрыть');
    closeButton.addEventListener('click', () => {
      close();
    });
    head.append(closeButton);
  }

  const canCopy =
    actions.onCopy !== undefined || actions.onCopyRich !== undefined || actions.onCopyImage !== undefined;

  card.append(head);
  card.append(panelBody(panel, actions));

  if (!canCopy && actions.onOpenChat === undefined) {
    return card;
  }

  const row = document.createElement('div');
  row.className = 'card-actions';

  if (canCopy) {
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'card-copy';
    copyButton.textContent = 'Копировать';
    copyButton.addEventListener('click', () => {
      // Заголовок карточки в буфер не попадает: копируется только markdown.
      void (async () => {
        try {
          await performCopy(actions, panel);
          showCopyResult(copyButton, 'Скопировано', COPY_FEEDBACK_MS);
        } catch {
          showCopyResult(copyButton, 'Не удалось скопировать', COPY_ERROR_MS);
        }
      })();
    });
    row.append(copyButton);
  }

  if (actions.onOpenChat !== undefined) {
    const openChat = actions.onOpenChat;
    const chatButton = document.createElement('button');
    chatButton.type = 'button';
    chatButton.className = 'card-copy';
    chatButton.textContent = 'Открыть в чате';
    chatButton.addEventListener('click', () => {
      openChat();
    });
    row.append(chatButton);
  }

  card.append(row);
  return card;
}
