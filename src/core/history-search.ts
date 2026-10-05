import type { HistoryEntry } from './history';
import type { Panel } from './types';

export const DEFAULT_SEARCH_LIMIT = 50;

export function normalizeHistoryText(value: string): string {
  return value.toLowerCase().replace(/ё/g, 'е');
}

function panelText(panel: Panel): string {
  switch (panel.kind) {
    case 'list':
      return [
        panel.title,
        ...panel.items.flatMap((item) => [item.title, item.subtitle ?? '', item.url ?? ''])
      ].join('\n');
    case 'text':
      return `${panel.title}\n${panel.markdown}`;
    case 'image':
      return `${panel.title}\n${panel.path}`;
  }
}

// Текст, по которому ищут реплику: сама реплика и содержимое карточки.
export function historyEntryText(entry: HistoryEntry): string {
  if (entry.kind === 'divider') {
    return '';
  }
  if (entry.kind === 'screenshot') {
    return `${entry.title}\n${entry.path}`;
  }
  return entry.panel === undefined ? entry.text : `${entry.text}\n${panelText(entry.panel)}`;
}

// Новые реплики первыми, без учёта регистра, «ё» равно «е». Разделители пропускаются.
export function searchHistoryEntries(
  entries: HistoryEntry[],
  query: string,
  limit: number = DEFAULT_SEARCH_LIMIT
): HistoryEntry[] {
  const needle = normalizeHistoryText(query.trim());
  if (needle === '' || limit <= 0) {
    return [];
  }
  const found: HistoryEntry[] = [];
  for (let index = entries.length - 1; index >= 0 && found.length < limit; index -= 1) {
    const entry = entries[index];
    if (entry.kind === 'divider') {
      continue;
    }
    if (normalizeHistoryText(historyEntryText(entry)).includes(needle)) {
      found.push(entry);
    }
  }
  return found;
}
