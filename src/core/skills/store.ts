import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Skill } from '../types';
import { validateSkill, type ValidationResult } from './validate';

const SKILL_SUFFIX = '.tishka.json';
const ID_PATTERN = /^[A-Za-z0-9-]+$/;

export class SkillValidationError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(`Навык не прошёл проверку: ${errors.join('; ')}`);
    this.name = 'SkillValidationError';
    this.errors = errors;
  }
}

export interface SkillStore {
  list(): Promise<Skill[]>;
  get(id: string): Promise<Skill | undefined>;
  save(skill: Skill): Promise<void>;
  remove(id: string): Promise<void>;
  importFile(path: string): Promise<ValidationResult>;
  exportFile(id: string, targetPath: string): Promise<void>;
  loadPresets(presetsDir: string): Promise<number>;
}

async function readSkillFile(path: string): Promise<Skill | undefined> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const result = validateSkill(parsed);
  return result.ok ? result.skill : undefined;
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
  await rename(temporary, path);
}

export function createSkillStore(dir: string): SkillStore {
  function fileFor(id: string): string {
    return join(dir, `${id}${SKILL_SUFFIX}`);
  }

  async function exists(id: string): Promise<boolean> {
    try {
      await readFile(fileFor(id), 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  async function uniqueId(base: string): Promise<string> {
    if (!(await exists(base))) {
      return base;
    }
    for (let n = 2; ; n += 1) {
      const candidate = `${base}-${n}`;
      if (!(await exists(candidate))) {
        return candidate;
      }
    }
  }

  return {
    async list(): Promise<Skill[]> {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return [];
      }
      const skills: Skill[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(SKILL_SUFFIX)) {
          continue;
        }
        const skill = await readSkillFile(join(dir, entry.name));
        if (skill !== undefined) {
          skills.push(skill);
        }
      }
      return skills.sort((a, b) => a.id.localeCompare(b.id));
    },

    async get(id: string): Promise<Skill | undefined> {
      if (!ID_PATTERN.test(id)) {
        return undefined;
      }
      return readSkillFile(fileFor(id));
    },

    async save(skill: Skill): Promise<void> {
      const result = validateSkill(skill);
      if (!result.ok) {
        throw new SkillValidationError(result.errors);
      }
      await writeJsonAtomically(fileFor(result.skill.id), result.skill);
    },

    async remove(id: string): Promise<void> {
      if (!ID_PATTERN.test(id)) {
        return;
      }
      try {
        await unlink(fileFor(id));
      } catch {
        // файла нет — удалять нечего
      }
    },

    async importFile(path: string): Promise<ValidationResult> {
      let raw: string;
      try {
        raw = await readFile(path, 'utf8');
      } catch {
        return { ok: false, errors: ['Не удалось прочитать файл навыка'] };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return { ok: false, errors: ['Файл навыка не является корректным JSON'] };
      }
      const result = validateSkill(parsed);
      if (!result.ok) {
        return result;
      }
      const id = await uniqueId(result.skill.id);
      const skill: Skill = { ...result.skill, id };
      await writeJsonAtomically(fileFor(id), skill);
      return { ok: true, skill };
    },

    async exportFile(id: string, targetPath: string): Promise<void> {
      const skill = await readSkillFile(fileFor(id));
      if (skill === undefined) {
        throw new Error(`Навык не найден: ${id}`);
      }
      await writeJsonAtomically(targetPath, skill);
    },

    async loadPresets(presetsDir: string): Promise<number> {
      let entries;
      try {
        entries = await readdir(presetsDir, { withFileTypes: true });
      } catch {
        return 0;
      }
      let added = 0;
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(SKILL_SUFFIX)) {
          continue;
        }
        const skill = await readSkillFile(join(presetsDir, entry.name));
        if (skill === undefined || (await exists(skill.id))) {
          continue;
        }
        await writeJsonAtomically(fileFor(skill.id), skill);
        added += 1;
      }
      return added;
    }
  };
}
