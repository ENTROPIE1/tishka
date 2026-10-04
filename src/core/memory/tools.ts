import type { EventBus, ToolRegistry, ToolResult } from '../types';
import { confirmTool, forgetTool, saveTool, searchTool, updateTool } from './tool-defs';
import type { AddMemoryInput, MemoryStore, UpdateMemoryPatch } from './types';

function ok(content: string, data?: unknown): ToolResult {
  return data === undefined ? { ok: true, content } : { ok: true, content, data };
}

function fail(error: string): ToolResult {
  return { ok: false, content: '', error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : undefined;
}

function describe(record: { id: string; text: string; tags: string[]; reviewAt?: string }): string {
  const tags = record.tags.length > 0 ? ` [${record.tags.join(', ')}]` : '';
  const review = record.reviewAt === undefined ? '' : ` (проверить: ${record.reviewAt})`;
  return `${record.id}: ${record.text}${tags}${review}`;
}

export function registerMemoryTools(registry: ToolRegistry, store: MemoryStore, events?: EventBus): void {
  const changed = (): void => events?.emit({ type: 'memory.changed' });

  registry.register(saveTool, async (args) => {
    const items = args.items;
    if (!Array.isArray(items) || items.length === 0) {
      return fail('Поле items должно быть непустым списком записей');
    }
    let added = 0;
    let updated = 0;
    const errors: Array<{ text: string; error: string }> = [];
    for (const raw of items) {
      if (!isRecord(raw) || typeof raw.text !== 'string') {
        errors.push({ text: '', error: 'У записи нет текста' });
        continue;
      }
      const input: AddMemoryInput = { text: raw.text };
      const tags = stringArray(raw.tags);
      if (tags !== undefined) {
        input.tags = tags;
      }
      if (typeof raw.reviewDays === 'number' && Number.isFinite(raw.reviewDays)) {
        input.reviewDays = raw.reviewDays;
      }
      try {
        const before = store.list().length;
        await store.add(input);
        if (store.list().length > before) {
          added += 1;
        } else {
          updated += 1;
        }
      } catch (error) {
        errors.push({ text: raw.text, error: errorMessage(error) });
      }
    }
    if (added + updated > 0) {
      changed();
    }
    const lines = [`Добавлено: ${added}, обновлено: ${updated}`];
    for (const item of errors) {
      lines.push(`Не сохранено (${item.text}): ${item.error}`);
    }
    return ok(lines.join('\n'), { added, updated, errors });
  });

  registry.register(searchTool, async (args) => {
    const query = args.query;
    if (typeof query !== 'string' || query.trim() === '') {
      return fail('Поле query должно быть непустой строкой');
    }
    const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.floor(args.limit) : undefined;
    const found = store.search(query, limit);
    if (found.length === 0) {
      return ok('По этой теме ничего не помню', []);
    }
    return ok(found.map(describe).join('\n'), found);
  });

  registry.register(updateTool, async (args) => {
    const id = args.id;
    if (typeof id !== 'string' || id.trim() === '') {
      return fail('Поле id должно быть непустой строкой');
    }
    const patch: UpdateMemoryPatch = {};
    if (typeof args.text === 'string') {
      patch.text = args.text;
    }
    const tags = stringArray(args.tags);
    if (tags !== undefined) {
      patch.tags = tags;
    }
    if (args.reviewDays === null) {
      patch.reviewDays = null;
    } else if (typeof args.reviewDays === 'number' && Number.isFinite(args.reviewDays)) {
      patch.reviewDays = args.reviewDays;
    }
    try {
      const record = await store.update(id, patch);
      if (record === undefined) {
        return fail(`Запись не найдена: ${id}`);
      }
      changed();
      return ok(`Запомнил по-новому: ${record.text}`, record);
    } catch (error) {
      return fail(errorMessage(error));
    }
  });

  registry.register(forgetTool, async (args) => {
    const id = args.id;
    if (typeof id !== 'string' || id.trim() === '') {
      return fail('Поле id должно быть непустой строкой');
    }
    const removed = await store.remove(id);
    if (!removed) {
      return fail(`Запись не найдена: ${id}`);
    }
    changed();
    return ok('Забыл эту запись');
  });

  registry.register(confirmTool, async (args) => {
    const ids = stringArray(args.ids);
    if (ids === undefined || ids.length === 0) {
      return fail('Поле ids должно быть непустым списком идентификаторов');
    }
    let confirmed = 0;
    for (const id of ids) {
      const record = await store.confirm(id);
      if (record !== undefined) {
        confirmed += 1;
      }
    }
    if (confirmed > 0) {
      changed();
    }
    return ok(`Подтверждено записей: ${confirmed}`, { confirmed });
  });
}
