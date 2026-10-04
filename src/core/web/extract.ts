import type { WebLink } from './types';

export interface ExtractResult {
  text: string;
  truncated: boolean;
  links: WebLink[];
}

// Чистая функция: принимает документ и возвращает текст страницы. Все помощники
// объявлены внутри, чтобы функцию можно было целиком передать строкой в скрытое
// окно и выполнить на самой странице.
export function extractFromDocument(
  document: Document,
  maxChars = 12000,
  maxLinks = 30
): ExtractResult {
  const normalize = (value: string | null): string => (value ?? '').replace(/\s+/g, ' ').trim();

  const blockTags = new Set([
    'p', 'div', 'section', 'article', 'main', 'blockquote', 'pre', 'figure', 'figcaption',
    'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'dl', 'dt', 'dd',
    'hr', 'br', 'address'
  ]);
  const isBlock = (tag: string): boolean => blockTags.has(tag) || /^h[1-6]$/.test(tag);

  const dropSelector = [
    'script', 'style', 'nav', 'header', 'footer', 'aside', 'form',
    'button', 'input', 'select', 'textarea',
    '[hidden]', '[aria-hidden="true"]',
    '.mw-editsection', '.navbox', '.vertical-navbox', '.reflist', '.references',
    '.mw-references-wrap', '.catlinks', '.printfooter', '.noprint', '#toc', '.toc',
    '.mw-jump-link', '.metadata'
  ].join(',');

  const pickRoot = (): Element => {
    for (const selector of ['#mw-content-text', 'article', 'main', '[role="main"]']) {
      const found = document.querySelector(selector);
      if (found !== null) {
        return found;
      }
    }
    return document.body;
  };

  const work = pickRoot().cloneNode(true) as Element;
  for (const node of Array.from(work.querySelectorAll(dropSelector))) {
    node.remove();
  }
  for (const node of Array.from(work.querySelectorAll('[style]'))) {
    const style = (node.getAttribute('style') ?? '').toLowerCase().replace(/\s+/g, '');
    if (style.includes('display:none') || style.includes('visibility:hidden')) {
      node.remove();
    }
  }

  const blocks: string[] = [];

  const renderList = (list: Element): void => {
    const items: string[] = [];
    for (const child of Array.from(list.children)) {
      if (child.tagName.toLowerCase() !== 'li') {
        continue;
      }
      let own = '';
      for (const node of Array.from(child.childNodes)) {
        if (node.nodeType === 1 && /^(ul|ol)$/.test((node as Element).tagName.toLowerCase())) {
          continue;
        }
        own += node.textContent ?? '';
      }
      const text = normalize(own);
      items.push(text === '' ? '-' : `- ${text}`);
    }
    if (items.length > 0) {
      blocks.push(items.join('\n'));
    }
    for (const child of Array.from(list.children)) {
      for (const nested of Array.from(child.children)) {
        if (/^(ul|ol)$/.test(nested.tagName.toLowerCase())) {
          renderList(nested);
        }
      }
    }
  };

  const renderTable = (table: Element): void => {
    const rows: string[] = [];
    for (const row of Array.from(table.querySelectorAll('tr'))) {
      const cells = Array.from(row.querySelectorAll('th, td'))
        .map((cell) => normalize(cell.textContent))
        .filter((cell) => cell !== '');
      if (cells.length > 0) {
        rows.push(cells.join(' | '));
      }
    }
    if (rows.length > 0) {
      blocks.push(rows.join('\n'));
    }
  };

  const renderElement = (element: Element): void => {
    const tag = element.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      const text = normalize(element.textContent);
      if (text !== '') {
        blocks.push(`${'#'.repeat(Number(tag[1]))} ${text}`);
      }
      return;
    }
    if (tag === 'ul' || tag === 'ol') {
      renderList(element);
      return;
    }
    if (tag === 'table') {
      renderTable(element);
      return;
    }
    if (tag === 'br' || tag === 'hr') {
      return;
    }
    renderChildren(element);
  };

  const renderChildren = (element: Element): void => {
    let buffer = '';
    const flush = (): void => {
      const text = normalize(buffer);
      if (text !== '') {
        blocks.push(text);
      }
      buffer = '';
    };
    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType === 3) {
        buffer += node.textContent ?? '';
        continue;
      }
      if (node.nodeType !== 1) {
        continue;
      }
      const child = node as Element;
      if (isBlock(child.tagName.toLowerCase())) {
        flush();
        renderElement(child);
      } else {
        buffer += child.textContent ?? '';
      }
    }
    flush();
  };

  renderChildren(work);

  const base = document.baseURI ?? '';
  const links: WebLink[] = [];
  const seen = new Set<string>();
  for (const anchor of Array.from(work.querySelectorAll('a[href]'))) {
    if (links.length >= maxLinks) {
      break;
    }
    const text = normalize(anchor.textContent);
    if (text === '') {
      continue;
    }
    let absolute: string;
    try {
      absolute = new URL(anchor.getAttribute('href') ?? '', base).href;
    } catch {
      continue;
    }
    if (!/^https?:/i.test(absolute) || seen.has(absolute)) {
      continue;
    }
    seen.add(absolute);
    links.push({ text, url: absolute });
  }

  const full = blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  let truncated = false;
  let text = full;
  if (full.length > maxChars) {
    truncated = true;
    const cut = full.lastIndexOf('\n\n', maxChars);
    text = full.slice(0, cut > 0 ? cut : maxChars).trim();
  }
  return { text, truncated, links };
}
