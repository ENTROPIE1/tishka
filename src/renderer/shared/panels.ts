import type { Panel } from '../../core/types';
import { markdownToPlain, renderMarkdown } from './markdown';

const COPY_FEEDBACK_MS = 1000;

export interface PanelActions {
  onCopy?: (text: string) => void;
  onCopyRich?: (html: string, text: string) => void;   // текстовая карточка: html и чистый текст сразу
  onOpenChat?: () => void;
  onClose?: () => void;
}

function fileUrl(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  return encodeURI(`file:///${normalized}`);
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

function panelBody(panel: Panel): HTMLElement {
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

  card.append(head);
  card.append(panelBody(panel));

  if (actions.onCopy === undefined && actions.onCopyRich === undefined && actions.onOpenChat === undefined) {
    return card;
  }

  const row = document.createElement('div');
  row.className = 'card-actions';

  if (actions.onCopy !== undefined || actions.onCopyRich !== undefined) {
    const copy = actions.onCopy;
    const copyRich = actions.onCopyRich;
    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'card-copy';
    copyButton.textContent = 'Копировать';
    copyButton.addEventListener('click', () => {
      if (panel.kind === 'text' && copyRich !== undefined) {
        // Заголовок карточки в буфер не попадает: копируется только markdown.
        copyRich(renderMarkdown(panel.markdown), markdownToPlain(panel.markdown));
      } else {
        copy?.(copyTextForPanel(panel));
      }
      copyButton.textContent = 'Скопировано';
      window.setTimeout(() => {
        copyButton.textContent = 'Копировать';
      }, COPY_FEEDBACK_MS);
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
