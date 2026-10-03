export interface PageRef {
  id: string;
  title: string;
  url: string;
}

export interface PageVersion extends PageRef {
  version: number;
  updated: string;
  updatedBy: string;
}

export interface PageContent extends PageVersion {
  text: string;
  truncated: boolean;
}

export interface PageHistoryItem {
  version: number;
  when: string;
  by: string;
  message: string;
}

export interface ConfluenceClient {
  getPageVersion(pageId: string): Promise<PageVersion>;
  getPage(pageId: string): Promise<PageContent>;
  getPageHistory(pageId: string, limit?: number): Promise<PageHistoryItem[]>;
  searchPages(query: string, limit?: number): Promise<PageRef[]>;
}

const TEXT_LIMIT = 20_000;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const REQUEST_TIMEOUT_MS = 20_000;

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  shy: '',
  mdash: '—',
  ndash: '–',
  laquo: '«',
  raquo: '»',
  hellip: '…'
};

interface RawLinks {
  base?: unknown;
  webui?: unknown;
}

interface RawVersion {
  number?: unknown;
  when?: unknown;
  by?: { displayName?: unknown };
}

interface RawPage {
  id?: unknown;
  title?: unknown;
  version?: RawVersion;
  body?: { view?: { value?: unknown } };
  _links?: RawLinks;
}

interface RawHistoryItem {
  number?: unknown;
  when?: unknown;
  by?: { displayName?: unknown };
  message?: unknown;
}

interface RawList<T> {
  results?: T;
}

export function createConfluenceClient(opts: {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
}): ConfluenceClient {
  const baseUrl = opts.baseUrl.replace(/\/+$/, '');
  const doFetch = opts.fetch ?? fetch;

  async function request(path: string, params: Record<string, string> = {}): Promise<unknown> {
    const url = buildUrl(baseUrl, path, params);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await doFetch(url, {
        headers: { Authorization: `Bearer ${opts.token}`, Accept: 'application/json' },
        signal: controller.signal
      });
    } catch (error) {
      // сюда попадает и срабатывание таймаута: abort проявляется как отказ сети
      throw new Error('Confluence недоступен, проверьте VPN', { cause: error });
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error('Confluence отклонил токен');
    }
    if (response.status === 404) {
      throw new Error('Страница не найдена');
    }
    if (!response.ok) {
      throw new Error(`Confluence вернул статус ${response.status}`);
    }
    try {
      return await response.json();
    } catch (error) {
      throw new Error('Confluence вернул некорректный ответ', { cause: error });
    }
  }

  async function getPageVersion(pageId: string): Promise<PageVersion> {
    const page = (await request(`/rest/api/content/${requirePageId(pageId)}`, {
      expand: 'version'
    })) as RawPage;
    return toPageVersion(page);
  }

  async function getPage(pageId: string): Promise<PageContent> {
    const page = (await request(`/rest/api/content/${requirePageId(pageId)}`, {
      expand: 'version,body.view'
    })) as RawPage;
    return { ...toPageVersion(page), ...toText(asText(page.body?.view?.value)) };
  }

  async function getPageHistory(pageId: string, limit?: number): Promise<PageHistoryItem[]> {
    const path = `/rest/experimental/content/${requirePageId(pageId)}/version`;
    const list = (await request(path, { limit: String(normalizeLimit(limit)) })) as RawList<
      RawHistoryItem[]
    >;
    return (list.results ?? []).map(toHistoryItem);
  }

  async function searchPages(query: string, limit?: number): Promise<PageRef[]> {
    const list = (await request('/rest/api/content/search', {
      cql: `type=page AND text ~ "${escapeCql(query)}"`,
      limit: String(normalizeLimit(limit))
    })) as RawList<RawPage[]>;
    return (list.results ?? []).map(toPageRef);
  }

  return { getPageVersion, getPage, getPageHistory, searchPages };
}

function buildUrl(baseUrl: string, path: string, params: Record<string, string>): string {
  const search = new URLSearchParams(params).toString();
  return search.length > 0 ? `${baseUrl}${path}?${search}` : `${baseUrl}${path}`;
}

function requirePageId(pageId: string): string {
  if (!/^\d+$/.test(pageId)) {
    throw new Error('Идентификатор страницы должен состоять из цифр');
  }
  return pageId;
}

function normalizeLimit(limit?: number): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.max(1, Math.trunc(limit)), MAX_LIMIT);
}

function escapeCql(query: string): string {
  return query.replace(/"/g, '\\"');
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function toPageVersion(page: RawPage): PageVersion {
  return {
    id: asText(page.id),
    title: asText(page.title),
    url: asText(page._links?.base) + asText(page._links?.webui),
    version: asNumber(page.version?.number),
    updated: asText(page.version?.when),
    updatedBy: asText(page.version?.by?.displayName)
  };
}

function toPageRef(page: RawPage): PageRef {
  return {
    id: asText(page.id),
    title: asText(page.title),
    url: asText(page._links?.base) + asText(page._links?.webui)
  };
}

function toHistoryItem(item: RawHistoryItem): PageHistoryItem {
  return {
    version: asNumber(item.number),
    when: asText(item.when),
    by: asText(item.by?.displayName),
    message: asText(item.message)
  };
}

function toText(html: string): { text: string; truncated: boolean } {
  const text = htmlToText(html);
  return { text: text.slice(0, TEXT_LIMIT), truncated: text.length > TEXT_LIMIT };
}

export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, '\n');
  const decoded = decodeEntities(withBreaks.replace(/<[^>]*>/g, ' '));
  const lines = decoded.split(/\r?\n/).map((line) => line.replace(/[ \t]+/g, ' ').trim());
  const collapsed: string[] = [];
  for (const line of lines) {
    if (line === '' && (collapsed.length === 0 || collapsed[collapsed.length - 1] === '')) {
      continue;
    }
    collapsed.push(line);
  }
  return collapsed.join('\n').trim();
}

function decodeEntities(text: string): string {
  return text.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, code: string) => {
    const lower = code.toLowerCase();
    if (lower.startsWith('#x')) {
      return fromCodePoint(parseInt(code.slice(2), 16));
    }
    if (lower.startsWith('#')) {
      return fromCodePoint(parseInt(code.slice(1), 10));
    }
    const named = NAMED_ENTITIES[lower];
    return named === undefined ? match : named;
  });
}

function fromCodePoint(code: number): string {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
}
