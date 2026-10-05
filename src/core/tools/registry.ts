import type { EventBus, ToolCallOptions, ToolDef, ToolHandler, ToolRegistry, ToolResult } from '../types';
import { CONFIRM_BACKGROUND_ERROR, CONFIRM_DENIED_ERROR } from './confirm';

function missingRequiredField(schema: object, args: Record<string, unknown>): string | undefined {
  const required = (schema as { required?: unknown }).required;
  if (!Array.isArray(required)) {
    return undefined;
  }
  for (const field of required) {
    if (typeof field !== 'string') {
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(args, field)) {
      return field;
    }
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runHandler(handler: ToolHandler, args: Record<string, unknown>): Promise<ToolResult> {
  try {
    return await handler(args);
  } catch (error) {
    return { ok: false, content: '', error: errorMessage(error) };
  }
}

export interface MutableToolRegistry extends ToolRegistry {
  remove(name: string): void;
}

// Наблюдатель за результатом вызова: счётчик дел и подобные слушатели.
export interface ToolRegistryHooks {
  onResult?(name: string, result: ToolResult): void | Promise<void>;
}

// Подтверждение человеком меняющих инструментов: политика решает, нужен ли
// вопрос, а ask ставит его и ждёт ответа.
export interface ToolConfirmation {
  required(def: ToolDef): boolean;
  ask(def: ToolDef, args: Record<string, unknown>): Promise<boolean>;
}

export function createToolRegistry(
  bus: EventBus,
  hooks?: ToolRegistryHooks,
  confirmation?: ToolConfirmation
): MutableToolRegistry {
  const tools = new Map<string, { def: ToolDef; handler: ToolHandler }>();

  return {
    register(def: ToolDef, handler: ToolHandler): void {
      tools.set(def.name, { def, handler });
    },
    remove(name: string): void {
      tools.delete(name);
    },
    unregisterSource(source: ToolDef['source']): void {
      for (const [name, entry] of tools) {
        if (entry.def.source === source) {
          tools.delete(name);
        }
      }
    },
    list(): ToolDef[] {
      return [...tools.values()].map((entry) => entry.def);
    },
    async call(name: string, args: Record<string, unknown>, opts?: ToolCallOptions): Promise<ToolResult> {
      const entry = tools.get(name);
      if (entry === undefined) {
        return { ok: false, content: '', error: `Неизвестный инструмент: ${name}` };
      }

      const missing = missingRequiredField(entry.def.inputSchema, args);
      if (missing !== undefined) {
        return { ok: false, content: '', error: `Не указано обязательное поле: ${missing}` };
      }

      const background = opts?.background === true;
      if (background) {
        bus.emit({ type: 'background.tick', tool: name });
      } else {
        bus.emit({ type: 'tool.start', tool: name });
      }

      let result: ToolResult;
      // Меняющий инструмент с подтверждением: фон не спрашивает, обычный ход ждёт
      // ответа человека. Отказ возвращает модели понятную ошибку.
      if (confirmation?.required(entry.def) === true) {
        if (background) {
          result = { ok: false, content: '', error: CONFIRM_BACKGROUND_ERROR };
        } else {
          const confirmed = await confirmation.ask(entry.def, args);
          if (!confirmed) {
            result = { ok: false, content: '', error: CONFIRM_DENIED_ERROR };
          } else {
            result = await runHandler(entry.handler, args);
          }
        }
      } else {
        result = await runHandler(entry.handler, args);
      }

      if (!background) {
        bus.emit({ type: 'tool.end', tool: name, ok: result.ok });
        try {
          await hooks?.onResult?.(name, result);
        } catch {
          // Слушатель результата не должен менять исход вызова инструмента.
        }
      }
      return result;
    }
  };
}
