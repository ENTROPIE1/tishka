import type { ToolDef, ToolRegistry, ToolResult } from '../types';
import type { WebToolsDeps } from './web-deps';

const DEFAULT_LANG = 'ru';
const SEARCH_LIMIT = 5;
const FETCH_TIMEOUT_MS = 10000;

export interface WikiSearchItem {
  title: string;
  snippet: string;
  url: string;
}

function ok(content: string, data?: unknown): ToolResult {
  return data === undefined ? { ok: true, content } : { ok: true, content, data };
}

function fail(error: string): ToolResult {
  return { ok: false, content: '', error };
}

function readLang(value: unknown): string {
  return typeof value === 'string' && /^[a-z]{2,3}(-[a-z]+)?$/i.test(value) ? value.toLowerCase() : DEFAULT_LANG;
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

function articleUrl(title: string, lang: string): string {
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

async function getJson(
  deps: WebToolsDeps,
  url: string
): Promise<{ ok: true; body: unknown } | { ok: false; error: string }> {
  const fetchFn = deps.fetch ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    return { ok: false, error: 'Не получилось связаться с Википедией' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? FETCH_TIMEOUT_MS);
  try {
    const response = await fetchFn(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) {
      return { ok: false, error: 'Википедия не ответила на запрос' };
    }
    return { ok: true, body: (await response.json()) as unknown };
  } catch {
    return { ok: false, error: 'Не получилось связаться с Википедией' };
  } finally {
    clearTimeout(timer);
  }
}

function parseSearch(body: unknown, lang: string): WikiSearchItem[] {
  const query = (body as { query?: { search?: unknown } } | null)?.query;
  if (!Array.isArray(query?.search)) {
    return [];
  }
  const items: WikiSearchItem[] = [];
  for (const entry of query.search) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const row = entry as Record<string, unknown>;
    if (typeof row.title !== 'string') {
      continue;
    }
    const snippet = typeof row.snippet === 'string' ? stripHtml(row.snippet) : '';
    items.push({ title: row.title, snippet, url: articleUrl(row.title, lang) });
  }
  return items;
}

function parseSummary(body: unknown): { title: string; extract: string; url?: string } {
  const row = (body as Record<string, unknown> | null) ?? {};
  const desktop = (row.content_urls as { desktop?: { page?: unknown } } | undefined)?.desktop;
  return {
    title: typeof row.title === 'string' ? row.title : '',
    extract: typeof row.extract === 'string' ? row.extract : '',
    url: typeof desktop?.page === 'string' ? desktop.page : undefined
  };
}

const wikiSearch: ToolDef = {
  name: 'wiki_search',
  description:
    'Ищет статьи в Википедии, когда человек просит найти что-то в интернете или в Википедии либо спрашивает о фактах внешнего мира.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Поисковый запрос' },
      lang: { type: 'string', description: 'Код языка Википедии, по умолчанию ru' }
    },
    required: ['query'],
    additionalProperties: false
  },
  source: 'builtin',
  readOnly: true
};

const wikiRead: ToolDef = {
  name: 'wiki_read',
  description: 'Читает краткое изложение статьи Википедии по названию, когда нужно ответить по конкретной статье.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Название статьи' },
      lang: { type: 'string', description: 'Код языка Википедии, по умолчанию ru' }
    },
    required: ['title'],
    additionalProperties: false
  },
  source: 'builtin',
  readOnly: true
};

export function registerWikiTools(registry: ToolRegistry, deps: WebToolsDeps): void {
  registry.register(wikiSearch, async (args) => {
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    if (query === '') {
      return fail('Не указан поисковый запрос');
    }
    const lang = readLang(args.lang);
    const endpoint = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=${SEARCH_LIMIT}&srsearch=${encodeURIComponent(query)}`;
    const response = await getJson(deps, endpoint);
    if (!response.ok) {
      return fail(response.error);
    }
    const items = parseSearch(response.body, lang);
    if (items.length === 0) {
      return ok('В Википедии ничего не нашлось');
    }
    const content = items
      .map((item, index) => `${index + 1}. ${item.title}\n${item.snippet}\n${item.url}`)
      .join('\n\n');
    return ok(content, { items });
  });

  registry.register(wikiRead, async (args) => {
    const title = typeof args.title === 'string' ? args.title.trim() : '';
    if (title === '') {
      return fail('Не указано название статьи');
    }
    const lang = readLang(args.lang);
    const endpoint = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const response = await getJson(deps, endpoint);
    if (!response.ok) {
      return fail(response.error);
    }
    const summary = parseSummary(response.body);
    if (summary.extract === '') {
      return ok('В Википедии нет статьи с таким названием');
    }
    const source = summary.url ?? articleUrl(summary.title || title, lang);
    return ok(`# ${summary.title || title}\n\n${summary.extract}\n\nИсточник: ${source}`, {
      title: summary.title || title,
      extract: summary.extract,
      url: source
    });
  });
}
