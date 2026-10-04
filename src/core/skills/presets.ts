import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { EventBus, Skill, ToolDef, ToolRegistry, ToolResult } from '../types';
import type { SkillStore } from './store';
import { validateSkill } from './validate';

const SKILL_SUFFIX = '.tishka.json';
const ID_PATTERN = /^[A-Za-z0-9-]+$/;

export interface PresetInfo {
  id: string;
  name: string;
  description: string;
  requires: string[];
  installed: boolean;
  valid: boolean;
  errors: string[];
}

export interface PresetStore {
  get(id: string): Promise<Skill | undefined>;
}

interface ParsedPreset {
  id: string;
  skill?: Skill;
  errors: string[];
}

async function presetFileNames(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(SKILL_SUFFIX))
    .map((entry) => entry.name)
    .sort();
}

async function readPreset(dir: string, fileName: string): Promise<ParsedPreset> {
  const id = fileName.slice(0, -SKILL_SUFFIX.length);
  let raw: string;
  try {
    raw = await readFile(join(dir, fileName), 'utf8');
  } catch {
    return { id, errors: ['Не удалось прочитать файл пресета'] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { id, errors: ['Файл пресета не является корректным JSON'] };
  }
  const result = validateSkill(parsed);
  return result.ok ? { id, skill: result.skill, errors: [] } : { id, errors: result.errors };
}

export async function listPresets(dir: string, store?: PresetStore): Promise<PresetInfo[]> {
  const presets: PresetInfo[] = [];
  for (const fileName of await presetFileNames(dir)) {
    const parsed = await readPreset(dir, fileName);
    const skill = parsed.skill;
    const id = skill?.id ?? parsed.id;
    const installed = store === undefined ? false : (await store.get(id)) !== undefined;
    presets.push({
      id,
      name: skill?.name ?? '',
      description: skill?.description ?? '',
      requires: skill?.requires ?? [],
      installed,
      valid: skill !== undefined,
      errors: parsed.errors
    });
  }
  return presets;
}

export async function installPreset(
  dir: string,
  id: string,
  store: SkillStore,
  opts: { overwrite?: boolean } = {}
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!ID_PATTERN.test(id)) {
    return { ok: false, error: 'Некорректный идентификатор пресета' };
  }
  const parsed = await readPreset(dir, `${id}${SKILL_SUFFIX}`);
  if (parsed.skill === undefined) {
    const reason = parsed.errors.join('; ');
    return { ok: false, error: `Пресет не установлен: ${reason === '' ? 'файл не найден' : reason}` };
  }
  const existing = await store.get(parsed.skill.id);
  if (existing !== undefined && opts.overwrite !== true) {
    return { ok: false, error: 'Навык уже установлен' };
  }
  await store.save(parsed.skill);
  return { ok: true };
}

const listTool: ToolDef = {
  name: 'presets_list',
  description:
    'Показывает готовые навыки-пресеты и их состояние, когда человек спрашивает, что ты умеешь, или хочет выбрать готовое дело.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  source: 'builtin',
  readOnly: true
};

const installTool: ToolDef = {
  name: 'preset_install',
  description: 'Ставит готовый навык-пресет по его идентификатору, когда человек выбрал подходящий.',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string', description: 'Идентификатор пресета из списка' } },
    required: ['id'],
    additionalProperties: false
  },
  source: 'builtin',
  readOnly: false
};

function ok(content: string, data?: unknown): ToolResult {
  return data === undefined ? { ok: true, content } : { ok: true, content, data };
}

function fail(error: string): ToolResult {
  return { ok: false, content: '', error };
}

function describe(info: PresetInfo): string {
  const requires = info.requires.length > 0 ? `, нужны: ${info.requires.join(', ')}` : '';
  const state = info.valid ? (info.installed ? 'установлен' : 'доступен') : 'повреждён';
  return `${info.id} — ${info.name} (${state}${requires}): ${info.description}`;
}

export interface PresetToolsDeps {
  presetsDir: string;
  store: SkillStore;
  events: EventBus;
}

export function registerPresetTools(registry: ToolRegistry, deps: PresetToolsDeps): void {
  registry.register(listTool, async () => {
    const presets = await listPresets(deps.presetsDir, deps.store);
    const ready = presets.filter((preset) => preset.valid);
    if (ready.length === 0) {
      return ok('Готовых навыков-пресетов нет', presets);
    }
    return ok(ready.map(describe).join('\n'), presets);
  });

  registry.register(installTool, async (args) => {
    const id = args.id;
    if (typeof id !== 'string' || id.trim() === '') {
      return fail('Поле id должно быть непустой строкой');
    }
    const result = await installPreset(deps.presetsDir, id.trim(), deps.store);
    if (!result.ok) {
      return fail(result.error);
    }
    deps.events.emit({ type: 'skill.saved', skillId: id.trim() });
    return ok(`Навык установлен: ${id.trim()}`);
  });
}
