import type { HistoryEntry } from './history';
import type { ToolDef, ToolRegistry, ToolResult } from './types';

export const HISTORY_TOOL_NAME = 'history_search';
export const HISTORY_TOOL_DEFAULT_LIMIT = 10;
export const HISTORY_MESSAGE_MAX = 600;

export interface HistorySearcher {
  search(query: string, limit?: number): HistoryEntry[];
}

export const historySearchTool: ToolDef = {
  name: HISTORY_TOOL_NAME,
  description:
    'Ищет реплики в истории чата по словам. Вызови, если человек ссылается на прошлый разговор, а в текущем контексте этого нет.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Слова для поиска' },
      limit: { type: 'number', description: 'Сколько реплик вернуть, по умолчанию 10' }
    },
    required: ['query'],
    additionalProperties: false
  },
  source: 'builtin',
  readOnly: true
};

const AUTHORS: Record<'user' | 'tishka' | 'system', string> = {
  user: 'человек',
  tishka: 'Тишка',
  system: 'система'
};

function clamp(text: string): string {
  return text.length <= HISTORY_MESSAGE_MAX ? text : `${text.slice(0, HISTORY_MESSAGE_MAX)}…`;
}

function describe(entry: HistoryEntry): string {
  if (entry.kind === 'divider') {
    return '';
  }
  const date = new Date(entry.at).toLocaleString('ru-RU');
  return `${date} — ${AUTHORS[entry.from]}: ${clamp(entry.text)}`;
}

export function registerHistoryTools(registry: ToolRegistry, history: HistorySearcher): void {
  registry.register(historySearchTool, async (args): Promise<ToolResult> => {
    const query = args.query;
    if (typeof query !== 'string' || query.trim() === '') {
      return { ok: false, content: '', error: 'Поле query должно быть непустой строкой' };
    }
    const requested = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : 0;
    const limit = Math.min(requested > 0 ? requested : HISTORY_TOOL_DEFAULT_LIMIT, HISTORY_TOOL_DEFAULT_LIMIT);
    const found = history.search(query, limit).filter((entry) => entry.kind === 'message');
    if (found.length === 0) {
      return { ok: true, content: 'В истории по этим словам ничего не нашлось' };
    }
    return { ok: true, content: found.map(describe).join('\n'), data: found };
  });
}
