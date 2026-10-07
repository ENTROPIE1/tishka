import type { Mood, MoodMark, Panel, Reply, ToolDef } from '../types';
import { isKnownMood } from './moods';

export const REPLY_TOOL_NAME = 'reply';

export const EMPTY_REPLY: Reply = { say: 'Не получилось ответить, попробуй ещё раз', mood: 'confused' };

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

// Меты эмоции — только [слово] из 2–20 латинских букв или подчёркиваний и не
// перед круглой скобкой: так ссылки [текст](адрес) и сноски [1] остаются как
// есть. [joy] открывает эмоцию, [/joy] закрывает в нейтраль. Позиция — в знаках
// очищенного текста. Неизвестное имя такого вида просто убирается.
const MOOD_MARK = /\[(\/)?([A-Za-z_]{2,20})\](?!\()/g;

export function stripMoodMarks(text: string): { text: string; moods: MoodMark[] } {
  const moods: MoodMark[] = [];
  let clean = '';
  let index = 0;
  const mark = new RegExp(MOOD_MARK.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = mark.exec(text)) !== null) {
    clean += text.slice(index, match.index);
    const closing = match[1] === '/';
    const name = match[2];
    let next = match.index + match[0].length;
    if (text[next] === ' ') {
      next += 1;
    }
    if (closing) {
      if (name === undefined || isKnownMood(name)) {
        moods.push({ at: clean.length, mood: 'neutral' });
      }
    } else if (isKnownMood(name)) {
      moods.push({ at: clean.length, mood: name });
    }
    index = next;
    mark.lastIndex = next;
  }
  clean += text.slice(index);
  const trimmed = clean.trim();
  const lead = clean.length - clean.trimStart().length;
  for (const item of moods) {
    item.at = Math.min(Math.max(0, item.at - lead), trimmed.length);
  }
  return { text: trimmed, moods };
}

function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?…]*[.!?…]+["»')\]]*\s*|[^.!?…]+$/g) ?? [];
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

export function replyFromText(text: string): Reply {
  const stripped = stripMoodMarks(text);
  const trimmed = stripped.text;
  if (trimmed.length === 0) {
    return { ...EMPTY_REPLY };
  }
  const sentences = splitSentences(trimmed);
  if (sentences.length <= 2) {
    return attachMoods({ say: trimmed, mood: 'neutral' }, stripped.moods);
  }
  const say = sentences.slice(0, 2).join(' ');
  return attachMoods({ say, show: { kind: 'text', title: 'Ответ', markdown: trimmed }, mood: 'neutral' }, stripped.moods);
}

function attachMoods(reply: Reply, moods: MoodMark[]): Reply {
  return moods.length > 0 ? { ...reply, moods } : reply;
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
  const raw = typeof args.say === 'string' && args.say.length > 0 ? args.say : (fallbackText ?? '').trim();
  const stripped = stripMoodMarks(raw);
  const say = stripped.text;
  const show = parsePanel(args.show);
  const ask = parseAsk(args.ask);
  if (say.length === 0 && show === undefined && ask === undefined) {
    return { ...EMPTY_REPLY };
  }
  const mood = parseMood(args.mood);
  const reply: Reply = attachMoods({ say, mood }, stripped.moods);
  if (show !== undefined) {
    reply.show = show;
  }
  if (ask !== undefined) {
    reply.ask = ask;
  }
  return reply;
}
