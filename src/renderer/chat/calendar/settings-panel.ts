import type { CalendarConfig } from '../../../core/calendar/types';
import type { ConnectionView } from '../../../main/ipc-settings';
import { clear } from '../../settings/dom';
import { renderSources, type SourceState } from './sources';
import { renderWorkHours, type WorkHoursChange } from './work-hours';

export interface SettingsPanelParams {
  box: HTMLElement;
  config: CalendarConfig;
  sources: Record<string, boolean>;
  connections: ConnectionView[];
  state: Record<string, SourceState>;
  syncEnabled: boolean;
  onWorkHours(change: WorkHoursChange): void;
  onToggle(name: string, enabled: boolean): void;
  onSync(): void;
}

export function renderSettingsPanel(params: SettingsPanelParams): void {
  clear(params.box);
  renderWorkHours(params.box, params.config, params.onWorkHours);
  renderSources(params.box, {
    connections: params.connections,
    sources: params.sources,
    state: params.state,
    syncEnabled: params.syncEnabled,
    onToggle: params.onToggle,
    onSync: params.onSync
  });
}

export function syncResultState(
  connections: ConnectionView[],
  result: { added: number; updated: number; removed: number; error?: string }
): Record<string, SourceState> {
  const state: SourceState = { loadedAt: new Date().toISOString(), added: result.added, updated: result.updated, removed: result.removed };
  if (result.error !== undefined) {
    state.error = result.error;
  }
  const next: Record<string, SourceState> = {};
  for (const connection of connections) {
    next[connection.name] = state;
  }
  return next;
}
