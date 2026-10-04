import { dialog, ipcMain } from 'electron';
import type { InstallPresetResult, SaveSkillResult, TishkaCore } from '../core/app';
import type { Skill } from '../core/types';
import {
  SKILL_ENABLED_CHANNEL,
  SKILL_EXPORT_CHANNEL,
  SKILL_IMPORT_CHANNEL,
  SKILL_INSTALL_CHANNEL,
  SKILL_OVERVIEW_CHANNEL,
  SKILL_PRESETS_CHANNEL,
  SKILL_REMOVE_CHANNEL,
  SKILL_RUN_CHANNEL,
  SKILL_SAVE_CHANNEL
} from './ipc-channels';

export interface ImportSkillResult {
  ok: boolean;
  canceled?: boolean;
  skill?: Skill;
  errors?: string[];
}

export interface ExportSkillResult {
  ok: boolean;
  canceled?: boolean;
  path?: string;
  error?: string;
}

const SKILL_FILTERS = [{ name: 'Навык Тишки', extensions: ['tishka.json', 'json'] }];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectArg(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

export function registerAutomationIpc(core: TishkaCore): void {
  ipcMain.handle(SKILL_OVERVIEW_CHANNEL, () => core.skills.overview());

  ipcMain.handle(SKILL_SAVE_CHANNEL, (_event, value: unknown): Promise<SaveSkillResult> | SaveSkillResult => {
    if (!isRecord(value)) {
      return { ok: false, errors: ['Навык должен быть объектом'] };
    }
    return core.skills.save(value as unknown as Skill);
  });

  ipcMain.handle(SKILL_REMOVE_CHANNEL, (_event, id: unknown): Promise<boolean> =>
    typeof id === 'string' ? core.skills.remove(id) : Promise.resolve(false)
  );

  ipcMain.handle(SKILL_ENABLED_CHANNEL, (_event, id: unknown, enabled: unknown): Promise<boolean> =>
    typeof id === 'string' && typeof enabled === 'boolean'
      ? core.skills.setEnabled(id, enabled)
      : Promise.resolve(false)
  );

  ipcMain.handle(SKILL_RUN_CHANNEL, (_event, id: unknown, inputs: unknown) =>
    typeof id === 'string' ? core.skills.run(id, objectArg(inputs)) : undefined
  );

  ipcMain.handle(SKILL_PRESETS_CHANNEL, () => core.skills.presets());

  ipcMain.handle(
    SKILL_INSTALL_CHANNEL,
    (_event, id: unknown, overwrite: unknown): Promise<InstallPresetResult> | InstallPresetResult =>
      typeof id === 'string' ? core.skills.installPreset(id, overwrite === true) : { ok: false, error: 'Нет идентификатора' }
  );

  ipcMain.handle(SKILL_IMPORT_CHANNEL, async (): Promise<ImportSkillResult> => {
    const chosen = await dialog.showOpenDialog({ properties: ['openFile'], filters: SKILL_FILTERS });
    const path = chosen.filePaths[0];
    if (chosen.canceled || path === undefined) {
      return { ok: false, canceled: true };
    }
    const result = await core.skills.previewImport(path);
    return result.ok ? { ok: true, skill: result.skill } : { ok: false, errors: result.errors };
  });

  ipcMain.handle(SKILL_EXPORT_CHANNEL, async (_event, id: unknown): Promise<ExportSkillResult> => {
    if (typeof id !== 'string') {
      return { ok: false, error: 'Нет идентификатора навыка' };
    }
    const chosen = await dialog.showSaveDialog({ defaultPath: `${id}.tishka.json`, filters: SKILL_FILTERS });
    if (chosen.canceled || chosen.filePath === undefined) {
      return { ok: false, canceled: true };
    }
    try {
      await core.skills.export(id, chosen.filePath);
      return { ok: true, path: chosen.filePath };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
