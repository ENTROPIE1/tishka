import { ipcMain } from 'electron';
import type { TishkaCore } from '../core/app';
import type { McpStatus } from '../core/mcp/manager';
import type { SecretStore } from '../core/types';
import { broadcastConfigChanged } from './ipc';
import {
  CONFIG_GET_CHANNEL,
  CONFIG_SAVE_CHANNEL,
  CONNECTIONS_PLAN_CHANNEL,
  CONNECTIONS_RECONNECT_CHANNEL,
  CONNECTIONS_REMOVE_CHANNEL,
  CONNECTIONS_SAVE_CHANNEL,
  CONNECTIONS_STATUS_CHANNEL,
  OPEN_SETTINGS_CHANNEL
} from './ipc-channels';
import { openSettingsWindow } from './settings-window';
import {
  configView,
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
  ConnectionView
} from './settings-types';

export function registerSettingsIpc(core: TishkaCore, secrets: SecretStore): void {
  ipcMain.handle(CONFIG_GET_CHANNEL, (): Promise<ConfigView> => configView(core));

  ipcMain.handle(CONFIG_SAVE_CHANNEL, async (_event, next: unknown) => {
    await saveConfigValue(core, next);
    broadcastConfigChanged();
  });

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
    openSettingsWindow();
  });
}
