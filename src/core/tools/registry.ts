import type { EventBus, ToolDef, ToolHandler, ToolRegistry, ToolResult } from '../types';

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

export function createToolRegistry(bus: EventBus): ToolRegistry {
  const tools = new Map<string, { def: ToolDef; handler: ToolHandler }>();

  return {
    register(def: ToolDef, handler: ToolHandler): void {
      tools.set(def.name, { def, handler });
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
    async call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
      const entry = tools.get(name);
      if (entry === undefined) {
        return { ok: false, content: '', error: `Неизвестный инструмент: ${name}` };
      }

      const missing = missingRequiredField(entry.def.inputSchema, args);
      if (missing !== undefined) {
        return { ok: false, content: '', error: `Не указано обязательное поле: ${missing}` };
      }

      bus.emit({ type: 'tool.start', tool: name });

      let result: ToolResult;
      try {
        result = await entry.handler(args);
      } catch (error) {
        result = { ok: false, content: '', error: errorMessage(error) };
      }

      bus.emit({ type: 'tool.end', tool: name, ok: result.ok });
      return result;
    }
  };
}
