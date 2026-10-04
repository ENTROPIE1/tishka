import type { Mood, Panel, Reply, ToolDef } from '../types';

export const REPLY_TOOL_NAME = 'reply';

const panelSchema = {
  description: 'Панель с подробностями, ровно один из трёх видов',
  oneOf: [
    {
      type: 'object',
      description: 'Список',
      properties: {
        kind: { type: 'string', enum: ['list'] },
        title: { type: 'string', description: 'Заголовок списка' },
        items: {
          type: 'array',
          description: 'Элементы списка',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              subtitle: { type: 'string' },
              url: { type: 'string' }
            },
            required: ['title'],
            additionalProperties: false
          }
        }
      },
      required: ['kind', 'title', 'items'],
      additionalProperties: false
    },
    {
      type: 'object',
      description: 'Текст в markdown',
      properties: {
        kind: { type: 'string', enum: ['text'] },
        title: { type: 'string', description: 'Заголовок' },
        markdown: { type: 'string', description: 'Содержание в markdown' }
      },
      required: ['kind', 'title', 'markdown'],
      additionalProperties: false
    },
    {
      type: 'object',
      description: 'Картинка',
      properties: {
        kind: { type: 'string', enum: ['image'] },
        title: { type: 'string', description: 'Заголовок' },
        path: { type: 'string', description: 'Путь к файлу картинки' }
      },
      required: ['kind', 'title', 'path'],
      additionalProperties: false
    }
  ]
};

const askSchema = {
  type: 'object',
  description: 'Просьба прислать текст: окно показывает человеку карточку ввода',
  properties: {
    title: { type: 'string', description: 'Что именно прислать' },
    placeholder: { type: 'string', description: 'Подсказка внутри поля ввода' }
  },
  required: ['title'],
  additionalProperties: false
};

export const replyTool: ToolDef = {
  name: REPLY_TOOL_NAME,
  description: 'Завершает работу и передаёт пользователю итоговый ответ.',
  inputSchema: {
    type: 'object',
    properties: {
      say: { type: 'string', description: 'Короткая фраза вслух' },
      show: panelSchema,
      ask: askSchema,
      mood: { type: 'string', enum: ['neutral', 'happy', 'confused'] }
    },
    required: ['say'],
    additionalProperties: false
  },
  source: 'builtin',
  readOnly: true
};

function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?…]*[.!?…]+["»')\]]*\s*|[^.!?…]+$/g) ?? [];
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

export function replyFromText(text: string): Reply {
  const trimmed = text.trim();
  const sentences = splitSentences(trimmed);
  if (sentences.length <= 2) {
    return { say: trimmed, mood: 'neutral' };
  }
  const say = sentences.slice(0, 2).join(' ');
  return { say, show: { kind: 'text', title: 'Ответ', markdown: trimmed }, mood: 'neutral' };
}

function parseMood(value: unknown): Mood {
  return value === 'happy' || value === 'confused' || value === 'neutral' ? value : 'neutral';
}

function parsePanel(value: unknown): Panel | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const panel = value as Record<string, unknown>;
  if (panel.kind === 'text' && typeof panel.markdown === 'string') {
    return value as Panel;
  }
  if (panel.kind === 'image' && typeof panel.path === 'string') {
    return value as Panel;
  }
  if (panel.kind === 'list' && Array.isArray(panel.items)) {
    return value as Panel;
  }
  return undefined;
}

function parseAsk(value: unknown): { title: string; placeholder?: string } | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const ask = value as Record<string, unknown>;
  if (typeof ask.title !== 'string' || ask.title.length === 0) {
    return undefined;
  }
  if (typeof ask.placeholder === 'string' && ask.placeholder.length > 0) {
    return { title: ask.title, placeholder: ask.placeholder };
  }
  return { title: ask.title };
}

export function replyFromToolArgs(args: Record<string, unknown>, fallbackText: string | null): Reply {
  const say = typeof args.say === 'string' && args.say.length > 0 ? args.say : (fallbackText ?? '').trim();
  const show = parsePanel(args.show);
  const ask = parseAsk(args.ask);
  const mood = parseMood(args.mood);
  const reply: Reply = { say, mood };
  if (show !== undefined) {
    reply.show = show;
  }
  if (ask !== undefined) {
    reply.ask = ask;
  }
  return reply;
}
