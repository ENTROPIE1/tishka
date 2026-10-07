import { ipcMain } from 'electron';
import type { TishkaCore } from '../core/app';
import type { GatewayCheckResult, GatewayModelsResult } from '../core/llm/check';
import type { McpStatus } from '../core/mcp/manager';
import type { MemoryRecord, UpdateMemoryPatch } from '../core/memory/store';
import type { SecretStore } from '../core/types';
import {
  CONFIG_GET_CHANNEL,
  CONFIG_SAVE_CHANNEL,
  CONNECTIONS_PLAN_CHANNEL,
  CONNECTIONS_RECONNECT_CHANNEL,
  CONNECTIONS_REMOVE_CHANNEL,
  CONNECTIONS_SAVE_CHANNEL,
  CONNECTIONS_STATUS_CHANNEL,
  GATEWAY_CHECK_CHANNEL,
  GATEWAY_MODELS_CHANNEL,
  MEMORY_CLEAR_CHANNEL,
  MEMORY_LIST_CHANNEL,
  MEMORY_REMOVE_CHANNEL,
  MEMORY_SEARCH_CHANNEL,
  MEMORY_UPDATE_CHANNEL,
  OPEN_SETTINGS_CHANNEL
} from './ipc-channels';
import { openMainWindow } from './chat-window';
import {
  checkGatewayValue,
  configView,
  listGatewayModelsValue,
  planDraft,
  reconnectConnection,
  removeConnection,
  saveConfigValue,
  saveConnection,
  statusViews
} from './settings-ops';
import type {
  ConfigView,
  ConnectionPlanResult,
  ConnectionSaveResult,
  ConnectionView
} from './settings-types';

export type {
  ConfigView,
  ConnectionPlanResult,
  ConnectionSaveResult,
  ConnectionSecretView,
  ConnectionView,
  SttCheckView,
  VoiceStateView
} from './settings-types';

function memoryPatch(value: unknown): { id: string; patch: UpdateMemoryPatch } | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record['id'] !== 'string') {
    return undefined;
  }
  const patch: UpdateMemoryPatch = {};
  if (typeof record['text'] === 'string') {
    patch.text = record['text'];
  }
  const tags = record['tags'];
  if (Array.isArray(tags) && tags.every((tag) => typeof tag === 'string')) {
    patch.tags = tags as string[];
  }
  if (record['reviewDays'] === null) {
    patch.reviewDays = null;
  } else if (typeof record['reviewDays'] === 'number' && Number.isFinite(record['reviewDays'])) {
    patch.reviewDays = record['reviewDays'];
  }
  return { id: record['id'], patch };
}

// Сохранение настроек само оповещает окна и применяет изменения: ядро зовёт
// onConfigChanged, переданный из главного процесса (см. createTishkaCore).
export function registerSettingsIpc(core: TishkaCore, secrets: SecretStore): void {
  ipcMain.handle(CONFIG_GET_CHANNEL, (): Promise<ConfigView> => configView(core));

  ipcMain.handle(CONFIG_SAVE_CHANNEL, async (_event, next: unknown) => {
    await saveConfigValue(core, next);
  });

  ipcMain.handle(GATEWAY_CHECK_CHANNEL, (_event, value: unknown): Promise<GatewayCheckResult> =>
    checkGatewayValue(core, value)
  );

  ipcMain.handle(GATEWAY_MODELS_CHANNEL, (_event, value: unknown): Promise<GatewayModelsResult> =>
    listGatewayModelsValue(core, value)
  );

  ipcMain.handle(CONNECTIONS_STATUS_CHANNEL, (): Promise<ConnectionView[]> => statusViews(core, secrets));

  ipcMain.handle(CONNECTIONS_PLAN_CHANNEL, (_event, value: unknown): ConnectionPlanResult => planDraft(core, value));

  ipcMain.handle(
    CONNECTIONS_SAVE_CHANNEL,
    (_event, value: unknown, previous: unknown): Promise<ConnectionSaveResult> =>
      saveConnection(core, secrets, value, previous)
  );

  ipcMain.handle(CONNECTIONS_REMOVE_CHANNEL, (_event, value: unknown) => removeConnection(core, secrets, value));

  ipcMain.handle(
    CONNECTIONS_RECONNECT_CHANNEL,
    (_event, value: unknown): Promise<McpStatus | undefined> => reconnectConnection(core, value)
  );

  ipcMain.handle(OPEN_SETTINGS_CHANNEL, () => {
    openMainWindow('connections');
  });

  ipcMain.handle(MEMORY_LIST_CHANNEL, (): MemoryRecord[] => core.memory());

  ipcMain.handle(MEMORY_SEARCH_CHANNEL, (_event, query: unknown): MemoryRecord[] =>
    typeof query === 'string' && query.trim() !== '' ? core.memorySearch(query) : core.memory()
  );

  ipcMain.handle(MEMORY_UPDATE_CHANNEL, (_event, value: unknown): Promise<MemoryRecord | undefined> => {
    const parsed = memoryPatch(value);
    return parsed === undefined ? Promise.resolve(undefined) : core.memoryUpdate(parsed.id, parsed.patch);
  });

  ipcMain.handle(MEMORY_REMOVE_CHANNEL, (_event, id: unknown): Promise<boolean> =>
    typeof id === 'string' ? core.memoryRemove(id) : Promise.resolve(false)
  );

  ipcMain.handle(MEMORY_CLEAR_CHANNEL, (): Promise<void> => core.memoryClear());
}
