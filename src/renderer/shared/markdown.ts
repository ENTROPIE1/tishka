const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

const CODE_MARKER = '\u0000';

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPE_MAP[char] ?? char);
}

function isWebUrl(url: string): boolean {
  return /^https?:\/\//.test(url);
}

function renderInline(text: string): string {
  // Код прячется под маркеры, чтобы его содержимое не превратилось в разметку.
  const codes: string[] = [];
  const withoutCode = text.replace(/`([^`\n]+)`/g, (_match, content: string) => {
    codes.push(`<code>${content}</code>`);
    return `${CODE_MARKER}${codes.length - 1}${CODE_MARKER}`;
  });
  const withBold = withoutCode.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  const withLinks = withBold.replace(
    /\[([^\]\n]+)\]\(([^()\s]+)\)/g,
    (match, label: string, url: string) =>
      isWebUrl(url) ? `<a href="${url}" data-url="${url}">${label}</a>` : match
  );
  return withLinks.replace(new RegExp(`${CODE_MARKER}(\\d+)${CODE_MARKER}`, 'g'), (match, index: string) => {
    const restored = codes[Number(index)];
    return restored ?? match;
  });
}

// Сначала весь текст экранируется, затем поверх безопасного текста наносится разметка.
export function renderMarkdown(source: string): string {
  const lines = escapeHtml(source).split('\n');
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: { tag: 'ul' | 'ol'; items: string[] } | undefined;
  let inFence = false;
  let fence: string[] = [];

  function flushParagraph(): void {
    if (paragraph.length > 0) {
      blocks.push(`<p>${paragraph.map(renderInline).join('<br>')}</p>`);
      paragraph = [];
    }
  }

  function flushList(): void {
    if (list === undefined) {
      return;
    }
    const items = list.items.map((item) => `<li>${renderInline(item)}</li>`).join('');
    blocks.push(`<${list.tag}>${items}</${list.tag}>`);
    list = undefined;
  }

  for (const line of lines) {
    if (inFence) {
      if (/^\s*```/.test(line)) {
        blocks.push(`<pre><code>${fence.join('\n')}</code></pre>`);
        fence = [];
        inFence = false;
      } else {
        fence.push(line);
      }
      continue;
    }
    if (/^\s*```/.test(line)) {
      flushParagraph();
      flushList();
      inFence = true;
      continue;
    }
    if (line.trim() === '') {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading !== null) {
      flushParagraph();
      flushList();
      const level = String(heading[1].length);
      blocks.push(`<h${level}>${renderInline(heading[2] ?? '')}</h${level}>`);
      continue;
    }
    const unordered = /^-\s+(.*)$/.exec(line);
    if (unordered !== null) {
      flushParagraph();
      if (list === undefined || list.tag !== 'ul') {
        flushList();
        list = { tag: 'ul', items: [] };
      }
      list.items.push(unordered[1] ?? '');
      continue;
    }
    const ordered = /^\d+\.\s+(.*)$/.exec(line);
    if (ordered !== null) {
      flushParagraph();
      if (list === undefined || list.tag !== 'ol') {
        flushList();
        list = { tag: 'ol', items: [] };
      }
      list.items.push(ordered[1] ?? '');
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  if (inFence) {
    blocks.push(`<pre><code>${fence.join('\n')}</code></pre>`);
  }
  flushParagraph();
  flushList();
  return blocks.join('\n');
}

function plainInline(text: string): string {
  const withoutCode = text.replace(/`([^`\n]+)`/g, '$1');
  const withLinks = withoutCode.replace(
    /\[([^\]\n]+)\]\(([^()\s]+)\)/g,
    (_match, label: string, url: string) => `${label} (${url})`
  );
  return withLinks.replace(/\*\*([^*\n]+)\*\*/g, '$1');
}

// Разметка без знаков форматирования: обратные кавычки и ** убираются,
// заголовки теряют решётки, пункты списка начинаются с «• » или номера.
export function markdownToPlain(source: string): string {
  const lines = source.split('\n');
  const out: string[] = [];
  let inFence = false;
  let fence: string[] = [];

  for (const line of lines) {
    if (inFence) {
      if (/^\s*```/.test(line)) {
        out.push(...fence);
        fence = [];
        inFence = false;
      } else {
        fence.push(line);
      }
      continue;
    }
    if (/^\s*```/.test(line)) {
      inFence = true;
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading !== null) {
      out.push(plainInline(heading[1] ?? ''));
      continue;
    }
    const unordered = /^(\s*)-\s+(.*)$/.exec(line);
    if (unordered !== null) {
      out.push(`${unordered[1] ?? ''}• ${plainInline(unordered[2] ?? '')}`);
      continue;
    }
    const ordered = /^(\s*)(\d+)\.\s+(.*)$/.exec(line);
    if (ordered !== null) {
      out.push(`${ordered[1] ?? ''}${ordered[2]}. ${plainInline(ordered[3] ?? '')}`);
      continue;
    }
    out.push(plainInline(line));
  }
  if (inFence) {
    out.push(...fence);
  }
  return out.join('\n');
}
