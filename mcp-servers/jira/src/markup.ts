const ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'"
};

function decodeEntities(text: string): string {
  return text.replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (match, name: string) => {
    const value = ENTITIES[name.toLowerCase()];
    return value === undefined ? match : value;
  });
}

export function jiraToText(markup: string): string {
  let text = markup;
  text = text
    .replace(/\{code(:[^}]*)?\}/gi, '\n')
    .replace(/\{noformat\}/gi, '\n')
    .replace(/\{(quote|panel|note|info|warning|tip)\}/gi, '\n');
  text = text.replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$1 ($2)').replace(/\[([^\]]+)\]/g, '$1');
  text = text.replace(/\{\{([^}]+)\}\}/g, '$1');
  text = text.replace(/^\s*h[1-6]\.\s*/gim, '');
  text = text.replace(/^\s*[*#-]+\s+/gm, '');
  text = text.replace(/\*([^*\n]+)\*/g, '$1').replace(/_([^_\n]+)_/g, '$1');
  text = decodeEntities(text);
  const lines = text.split(/\r?\n/).map((line) => line.replace(/[ \t]+/g, ' ').trim());
  const collapsed: string[] = [];
  for (const line of lines) {
    if (line === '' && (collapsed.length === 0 || collapsed[collapsed.length - 1] === '')) {
      continue;
    }
    collapsed.push(line);
  }
  return collapsed.join('\n').trim();
}

export function preview(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
