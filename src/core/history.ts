import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { searchHistoryEntries } from './history-search';
import type { EventBus, Mood, Panel, TishkaEvent } from './types';

export interface HistoryMessage {
  kind: 'message';
  id: string;
  at: string;                       // ISO
  from: 'user' | 'tishka' | 'system';
  text: string;                     // реплика пользователя, say Тишки или текст уведомления
  panel?: Panel;
  mood?: Mood;
}

export interface HistoryDivider {
  kind: 'divider';
  id: string;
  at: string;
}

export type HistoryEntry = HistoryMessage | HistoryDivider;

export interface History {
  start(): Promise<void>;           // читает файл, подписывается на события
  stop(): void;
  list(limit?: number): HistoryEntry[];   // последние записи по порядку, по умолчанию 200
  search(query: string, limit?: number): HistoryEntry[];
  addDivider(): void;               // запись-разделитель: начало нового разговора
  clear(): Promise<void>;
}

const MAX_FILE_LINES = 2000;
const KEEP_FILE_LINES = 1000;
const DEFAULT_LIMIT = 200;
const SOURCES = new Set(['user', 'tishka', 'system']);

function parseEntry(line: string): HistoryEntry | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (record['kind'] === 'divider') {
    if (typeof record['id'] !== 'string' || typeof record['at'] !== 'string') {
      return undefined;
    }
    return { kind: 'divider', id: record['id'], at: record['at'] };
  }
  const from = record['from'];
  if (
    typeof record['id'] !== 'string' ||
    typeof record['at'] !== 'string' ||
    typeof record['text'] !== 'string' ||
    typeof from !== 'string' ||
    !SOURCES.has(from)
  ) {
    return undefined;
  }
  const entry: HistoryMessage = {
    kind: 'message',
    id: record['id'],
    at: record['at'],
    from: from as HistoryMessage['from'],
    text: record['text']
  };
  if (record['panel'] !== undefined) {
    entry.panel = record['panel'] as Panel;
  }
  if (record['mood'] !== undefined) {
    entry.mood = record['mood'] as Mood;
  }
  return entry;
}

// Записи в файл идут синхронно, чтобы история пережила падение приложения
// и новый экземпляр всегда видел уже записанные события.
export function createHistory(filePath: string, events: EventBus, now: () => Date): History {
  let entries: HistoryEntry[] = [];
  let unsubscribe: (() => void) | undefined;

  function toEntry(event: TishkaEvent): HistoryMessage | undefined {
    const base = { kind: 'message', id: randomUUID(), at: now().toISOString() } as const;
    switch (event.type) {
      case 'listen.end':
        return { ...base, from: 'user', text: event.text };
      case 'reply':
        return {
          ...base,
          from: 'tishka',
          text: event.reply.say,
          panel: event.reply.show,
          mood: event.reply.mood
        };
      case 'notify':
        return { ...base, from: 'system', text: event.title };
      case 'error':
        return { ...base, from: 'system', text: event.message };
      default:
        return undefined;
    }
  }

  function append(entry: HistoryEntry): void {
    entries.push(entry);
    try {
      appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch {
      // Файл мог стать недоступен: история в памяти продолжает работать.
    }
  }

  async function start(): Promise<void> {
    mkdirSync(dirname(filePath), { recursive: true });
    let lines: string[] = [];
    if (existsSync(filePath)) {
      lines = readFileSync(filePath, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '');
      if (lines.length > MAX_FILE_LINES) {
        lines = lines.slice(-KEEP_FILE_LINES);
        writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf8');
      }
    }
    entries = lines
      .map(parseEntry)
      .filter((entry): entry is HistoryEntry => entry !== undefined);
    unsubscribe = events.on((event) => {
      const entry = toEntry(event);
      if (entry !== undefined) {
        append(entry);
      }
    });
  }

  function stop(): void {
    unsubscribe?.();
    unsubscribe = undefined;
  }

  function list(limit: number = DEFAULT_LIMIT): HistoryEntry[] {
    if (limit <= 0) {
      return [];
    }
    return entries.slice(-limit);
  }

  function search(query: string, limit?: number): HistoryEntry[] {
    return searchHistoryEntries(entries, query, limit);
  }

  function addDivider(): void {
    append({ kind: 'divider', id: randomUUID(), at: now().toISOString() });
  }

  async function clear(): Promise<void> {
    entries = [];
    try {
      writeFileSync(filePath, '', 'utf8');
    } catch {
      // Не удалось очистить файл: память всё равно очищена.
    }
  }

  return { start, stop, list, search, addDivider, clear };
}
