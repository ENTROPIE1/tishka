import type { SaveSkillResult } from '../../../core/app';
import type { ExportSkillResult, ImportSkillResult } from '../../../main/ipc-automations';
import type { Reply, Skill } from '../../../core/types';

export interface SkillApi {
  save(skill: Skill): Promise<SaveSkillResult>;
  remove(id: string): Promise<boolean>;
  run(id: string, inputs?: Record<string, unknown>): Promise<Reply>;
  exportFile(id: string): Promise<ExportSkillResult>;
  importFile(): Promise<ImportSkillResult>;
}

export interface MyTabDeps {
  api: SkillApi;
  confirm(message: string): boolean | Promise<boolean>;
  onChanged(): void;
}
