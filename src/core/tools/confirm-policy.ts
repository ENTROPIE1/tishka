import type { McpServerConfig, ToolDef } from '../types';

// Имя подключения из источника инструмента: `mcp:jira` → `jira`.
export function connectionOf(def: ToolDef): string {
  return def.source.startsWith('mcp:') ? def.source.slice('mcp:'.length) : '';
}

// Меняющий инструмент чужого сервера MCP спрашивает человека, пока настройка
// подключения не выключена (нет поля — включена). Встроенные и обратимые
// инструменты ядра, а также навыки подтверждения не требуют.
export function requiresConfirm(def: ToolDef, servers: McpServerConfig[]): boolean {
  if (def.readOnly || !def.source.startsWith('mcp:')) {
    return false;
  }
  const server = servers.find((item) => item.name === connectionOf(def));
  return server?.confirmChanges !== false;
}
