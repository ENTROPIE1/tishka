import type { MemoryRecord } from './types';

export const MAX_RECORDS = 2000;
export const MAX_TEXT = 500;
export const DAY_MS = 24 * 60 * 60 * 1000;

export interface MemoryFile {
  records: MemoryRecord[];
  reviewDays: Record<string, number>;
  lastReview?: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function dedupeKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function addDays(now: Date, days: number): string {
  return new Date(now.getTime() + days * DAY_MS).toISOString();
}

function parseRecord(value: unknown): MemoryRecord | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.text !== 'string') {
    return undefined;
  }
  const tags = Array.isArray(value.tags)
    ? value.tags.filter((tag): tag is string => typeof tag === 'string')
    : [];
  const record: MemoryRecord = {
    id: value.id,
    text: value.text,
    tags,
    created: typeof value.created === 'string' ? value.created : '',
    updated: typeof value.updated === 'string' ? value.updated : '',
    source: value.source === 'skill' ? 'skill' : 'user'
  };
  if (typeof value.reviewAt === 'string') {
    record.reviewAt = value.reviewAt;
  }
  return record;
}

export function parseFile(raw: unknown): MemoryFile {
  const file: MemoryFile = { records: [], reviewDays: {} };
  if (!isRecord(raw)) {
    return file;
  }
  if (Array.isArray(raw.records)) {
    for (const item of raw.records) {
      const record = parseRecord(item);
      if (record !== undefined) {
        file.records.push(record);
      }
    }
  }
  if (isRecord(raw.reviewDays)) {
    for (const [id, days] of Object.entries(raw.reviewDays)) {
      if (typeof days === 'number' && Number.isFinite(days)) {
        file.reviewDays[id] = days;
      }
    }
  }
  if (typeof raw.lastReview === 'string') {
    file.lastReview = raw.lastReview;
  }
  return file;
}
