import type { EventBus, ToolResult } from '../types';
import { classifyTool } from './deeds';
import type { StatsStore } from './store';
import type { DeedInput } from './types';

export interface StatsRecorder {
  deed(input: DeedInput): Promise<void>;
  fromTool(name: string, result: ToolResult): Promise<void>;
}

// Запись дела не должна мешать самому делу: сбой счётчика проглатывается,
// ошибка уходит в журнал, а инструмент отвечает как обычно.
export function createStatsRecorder(store: StatsStore, events: EventBus): StatsRecorder {
  async function deed(input: DeedInput): Promise<void> {
    try {
      await store.record(input);
      events.emit({ type: 'stats.changed' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[tishka] не удалось записать дело: ${message}`);
    }
  }

  return {
    deed,

    async fromTool(name: string, result: ToolResult): Promise<void> {
      if (!result.ok) {
        return;
      }
      const match = classifyTool(name);
      if (match === undefined) {
        return;
      }
      await deed({ kind: match.kind, title: match.title });
    }
  };
}
