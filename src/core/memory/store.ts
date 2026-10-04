import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { addDays, DAY_MS, dedupeKey, MAX_RECORDS, MAX_TEXT, parseFile, type MemoryFile } from './file';
import { searchRecords } from './search';
import type { AddMemoryInput, MemoryRecord, MemoryStore, UpdateMemoryPatch } from './types';
export type { AddMemoryInput, MemoryRecord, MemoryStore, UpdateMemoryPatch } from './types';

export function createMemoryStore(opts: { filePath: string; now: () => Date }): MemoryStore {
  let records: MemoryRecord[] = [];
  let reviewDays: Record<string, number> = {};
  let lastReviewAt: string | undefined;
  let loadPromise: Promise<void> | undefined;
  let chain: Promise<unknown> = Promise.resolve();

  function exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = chain.then(task);
    chain = result.catch(() => undefined);
    return result;
  }

  async function readFromDisk(): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(opts.filePath, 'utf8'));
    } catch {
      return;
    }
    const file = parseFile(parsed);
    records = file.records;
    reviewDays = file.reviewDays;
    lastReviewAt = file.lastReview;
  }

  async function save(): Promise<void> {
    await mkdir(dirname(opts.filePath), { recursive: true });
    const file: MemoryFile = { records, reviewDays };
    if (lastReviewAt !== undefined) {
      file.lastReview = lastReviewAt;
    }
    const temporary = `${opts.filePath}.tmp`;
    await writeFile(temporary, JSON.stringify(file, null, 2), 'utf8');
    await rename(temporary, opts.filePath);
  }

  function load(): Promise<void> {
    if (loadPromise === undefined) {
      loadPromise = readFromDisk();
    }
    return loadPromise;
  }

  function findById(id: string): MemoryRecord | undefined {
    return records.find((record) => record.id === id);
  }

  function checkText(raw: string): string {
    const text = raw.trim();
    if (text === '') {
      throw new Error('Текст записи не может быть пустым');
    }
    if (text.length > MAX_TEXT) {
      throw new Error(`Текст записи длиннее ${MAX_TEXT} символов`);
    }
    return text;
  }

  return {
    load,

    add(input: AddMemoryInput): Promise<MemoryRecord> {
      return exclusive(async () => {
        await load();
        const text = checkText(input.text);
        const now = opts.now();
        const key = dedupeKey(text);
        const existing = records.find((record) => dedupeKey(record.text) === key);
        if (existing !== undefined) {
          existing.updated = now.toISOString();
          await save();
          return existing;
        }
        if (records.length >= MAX_RECORDS) {
          throw new Error(`Предел памяти: ${MAX_RECORDS} записей`);
        }
        const record: MemoryRecord = {
          id: randomUUID(),
          text,
          tags: input.tags ?? [],
          created: now.toISOString(),
          updated: now.toISOString(),
          source: input.source ?? 'user'
        };
        if (input.reviewDays !== undefined) {
          record.reviewAt = addDays(now, input.reviewDays);
          reviewDays[record.id] = input.reviewDays;
        }
        records.push(record);
        await save();
        return record;
      });
    },

    update(id: string, patch: UpdateMemoryPatch): Promise<MemoryRecord | undefined> {
      return exclusive(async () => {
        await load();
        const record = findById(id);
        if (record === undefined) {
          return undefined;
        }
        const now = opts.now();
        if (patch.text !== undefined) {
          record.text = checkText(patch.text);
        }
        if (patch.tags !== undefined) {
          record.tags = patch.tags;
        }
        if (patch.reviewDays === null) {
          delete record.reviewAt;
          delete reviewDays[id];
        } else if (patch.reviewDays !== undefined) {
          record.reviewAt = addDays(now, patch.reviewDays);
          reviewDays[id] = patch.reviewDays;
        }
        record.updated = now.toISOString();
        await save();
        return record;
      });
    },

    remove(id: string): Promise<boolean> {
      return exclusive(async () => {
        await load();
        const before = records.length;
        records = records.filter((record) => record.id !== id);
        delete reviewDays[id];
        if (records.length === before) {
          return false;
        }
        await save();
        return true;
      });
    },

    list(): MemoryRecord[] {
      return [...records];
    },

    search(query: string, limit?: number): MemoryRecord[] {
      return searchRecords(records, query, limit);
    },

    due(): MemoryRecord[] {
      const nowMs = opts.now().getTime();
      return records.filter(
        (record) => record.reviewAt !== undefined && Date.parse(record.reviewAt) <= nowMs
      );
    },

    confirm(id: string): Promise<MemoryRecord | undefined> {
      return exclusive(async () => {
        await load();
        const record = findById(id);
        if (record === undefined || record.reviewAt === undefined) {
          return record;
        }
        const stored = reviewDays[id];
        const fallback = Math.round((Date.parse(record.reviewAt) - Date.parse(record.created)) / DAY_MS);
        const days = stored ?? (Number.isFinite(fallback) && fallback > 0 ? fallback : undefined);
        if (days !== undefined) {
          record.reviewAt = addDays(opts.now(), days);
          reviewDays[id] = days;
          await save();
        }
        return record;
      });
    },

    clear(): Promise<void> {
      return exclusive(async () => {
        await load();
        records = [];
        reviewDays = {};
        await save();
      });
    },

    lastReview(): string | undefined {
      return lastReviewAt;
    },

    setLastReview(iso: string): Promise<void> {
      return exclusive(async () => {
        await load();
        lastReviewAt = iso;
        await save();
      });
    }
  };
}
