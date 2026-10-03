import type { Panel, ToolDef, ToolRegistry, ToolResult } from '../types';

export interface BuiltinDeps {
  openExternal(url: string): Promise<void>;
  showPanel(panel: Panel): void;
  now(): Date;
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

function isAllowedUrl(url: string): boolean {
  try {
    return ALLOWED_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

function ok(content: string, data?: unknown): ToolResult {
  return data === undefined ? { ok: true, content } : { ok: true, content, data };
}

function fail(error: string): ToolResult {
  return { ok: false, content: '', error };
}

const openUrl: ToolDef = {
  name: 'open_url',
  description: 'Открывает ссылку в браузере по умолчанию, когда пользователю нужно перейти на страницу.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Адрес страницы, начинается с http или https' }
    },
    required: ['url'],
    additionalProperties: false
  },
  source: 'builtin',
  readOnly: false
};

const openUrls: ToolDef = {
  name: 'open_urls',
  description: 'Открывает несколько ссылок по очереди, когда пользователю нужен набор страниц за один раз.',
  inputSchema: {
    type: 'object',
    properties: {
      urls: {
        type: 'array',
        items: { type: 'string' },
        description: 'Список адресов, каждый начинается с http или https'
      }
    },
    required: ['urls'],
    additionalProperties: false
  },
  source: 'builtin',
  readOnly: false
};

const showPanel: ToolDef = {
  name: 'show_panel',
  description: 'Показывает пользователю панель с подробностями, чтобы ответ было удобно читать.',
  inputSchema: {
    type: 'object',
    properties: {
      panel: { type: 'object', description: 'Панель со списком, текстом или картинкой' }
    },
    required: ['panel'],
    additionalProperties: false
  },
  source: 'builtin',
  readOnly: true
};

const getTime: ToolDef = {
  name: 'get_time',
  description: 'Сообщает текущие дату и время с днём недели, когда пользователю нужно узнать, какой сейчас момент.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false
  },
  source: 'builtin',
  readOnly: true
};

export function registerBuiltinTools(registry: ToolRegistry, deps: BuiltinDeps): void {
  registry.register(openUrl, async (args) => {
    const url = args.url;
    if (typeof url !== 'string' || !isAllowedUrl(url)) {
      return fail('Разрешены только ссылки http и https');
    }
    await deps.openExternal(url);
    return ok(`Открыл ссылку: ${url}`);
  });

  registry.register(openUrls, async (args) => {
    const urls = args.urls;
    if (!Array.isArray(urls) || !urls.every((item) => typeof item === 'string')) {
      return fail('Поле urls должно быть списком строк');
    }
    const links = urls as string[];
    if (!links.every(isAllowedUrl)) {
      return fail('Разрешены только ссылки http и https');
    }
    for (const url of links) {
      await deps.openExternal(url);
    }
    return ok(`Открыл ссылок: ${links.length}`, { urls: links });
  });

  registry.register(showPanel, async (args) => {
    const panel = args.panel;
    if (typeof panel !== 'object' || panel === null) {
      return fail('Поле panel должно быть панелью');
    }
    deps.showPanel(panel as Panel);
    return ok('Показал панель');
  });

  registry.register(getTime, async () => {
    const date = deps.now();
    const iso = date.toISOString();
    const weekday = new Intl.DateTimeFormat('ru-RU', { weekday: 'long' }).format(date);
    return ok(`${iso}, ${weekday}`, { iso, weekday });
  });
}
