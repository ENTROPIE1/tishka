export const PREVIEW_LIMIT = 200;
export const BODY_LIMIT = 8000;

const QUOTE_MARK = /^\s*(>|_{5,}|-{2,}\s*(original|исходн)|от:|from:|-----)/i;
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
};

// Письмо может прийти с HTML; в ответ модели уходит только простой текст.
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|tr|h[1-6]|blockquote)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(withBreaks)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n');
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, name: string) => {
    if (name.startsWith('#')) {
      const radix = name[1] === 'x' || name[1] === 'X' ? 16 : 10;
      const code = Number.parseInt(name.slice(radix === 16 ? 2 : 1), radix);
      return Number.isNaN(code) ? match : String.fromCodePoint(code);
    }
    return ENTITIES[name.toLowerCase()] ?? match;
  });
}

// Цитаты прошлых писем не нужны целиком: от первой строки-цитаты остаётся «…».
export function foldQuotes(text: string): string {
  const lines: string[] = [];
  for (const line of text.split('\n')) {
    if (QUOTE_MARK.test(line)) {
      lines.push('…');
      break;
    }
    lines.push(line);
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function truncateText(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) {
    return { text, truncated: false };
  }
  return { text: text.slice(0, limit), truncated: true };
}

export function mailPreview(body: unknown): string {
  if (typeof body !== 'string') {
    return '';
  }
  return truncateText(foldQuotes(htmlToText(body)), PREVIEW_LIMIT).text;
}

export function mailBody(body: unknown): { text: string; truncated: boolean } {
  if (typeof body !== 'string') {
    return { text: '', truncated: false };
  }
  return truncateText(foldQuotes(htmlToText(body)), BODY_LIMIT);
}
