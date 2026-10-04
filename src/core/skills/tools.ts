import type { EventBus, Skill, ToolDef, ToolRegistry, ToolResult } from '../types';
import { validateSkill } from './validate';

export interface SkillToolsStore {
  list(): Promise<Skill[]>;
  get(id: string): Promise<Skill | undefined>;
  save(skill: Skill): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface SkillToolsDeps {
  store: SkillToolsStore;
  registry: ToolRegistry;        // для списка известных инструментов
  events: EventBus;
}

export const SKILL_TOOL_NAMES = ['save_skill', 'list_skills', 'get_skill', 'delete_skill'] as const;

const SKILL_PREFIX = 'skill__';

function ok(content: string, data?: unknown): ToolResult {
  return data === undefined ? { ok: true, content } : { ok: true, content, data };
}

function fail(error: string): ToolResult {
  return { ok: false, content: '', error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Инструменты, которые разрешены в шагах навыка: всё из реестра, кроме
// инструментов самих навыков и инструментов этого мастера.
export function stepTools(registry: ToolRegistry): ToolDef[] {
  return registry.list().filter((def) => {
    if (def.name.startsWith(SKILL_PREFIX)) {
      return false;
    }
    return !(SKILL_TOOL_NAMES as readonly string[]).includes(def.name);
  });
}

function triggerKindText(trigger: Skill['trigger']): string {
  if (trigger.type === 'manual') {
    return 'ручной запуск по фразе';
  }
  if (trigger.type === 'schedule') {
    const source = trigger.cron ?? trigger.at ?? '';
    return `расписание (${source})`;
  }
  const field = trigger.field === undefined ? '' : `, поле ${trigger.field}`;
  return `наблюдение: ${trigger.tool} каждые ${trigger.everyMinutes} мин${field}`;
}

function phrasesText(skill: Skill): string {
  return skill.phrases.length === 0 ? 'нет' : skill.phrases.join(', ');
}

function describeSkill(skill: Skill): string {
  return `${skill.id} — ${skill.name} (триггер: ${triggerKindText(skill.trigger)}), фразы: ${phrasesText(skill)}`;
}

const saveSkill: ToolDef = {
  name: 'save_skill',
  description:
    'Сохраняет навык целиком. Навык с существующим id заменяется — так правят навык. При ошибках проверки вернёт их списком, исправь и вызови снова.',
  inputSchema: {
    type: 'object',
    properties: {
      skill: { type: 'object', description: 'Навык в формате tishka-skill/1 целиком' }
    },
    required: ['skill'],
    additionalProperties: false
  },
  source: 'builtin',
  readOnly: false
};

const listSkills: ToolDef = {
  name: 'list_skills',
  description: 'Показывает список сохранённых навыков: идентификатор, название, фразы, вид триггера.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false
  },
  source: 'builtin',
  readOnly: true
};

const getSkill: ToolDef = {
  name: 'get_skill',
  description: 'Возвращает полное описание одного навыка в формате JSON.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Идентификатор навыка' }
    },
    required: ['id'],
    additionalProperties: false
  },
  source: 'builtin',
  readOnly: true
};

const deleteSkill: ToolDef = {
  name: 'delete_skill',
  description: 'Удаляет сохранённый навык по его идентификатору.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Идентификатор навыка' }
    },
    required: ['id'],
    additionalProperties: false
  },
  source: 'builtin',
  readOnly: false
};

function validationFailed(errors: string[]): ToolResult {
  const list = errors.map((error) => `- ${error}`).join('\n');
  return {
    ok: false,
    content: ['Навык не сохранён, ошибки проверки:', list, 'Исправь их и вызови save_skill снова.'].join('\n')
  };
}

export function registerSkillTools(registry: ToolRegistry, deps: SkillToolsDeps): void {
  registry.register(saveSkill, async (args) => {
    const raw = args.skill;
    if (!isRecord(raw)) {
      return fail('Поле skill должно быть объектом навыка');
    }
    const knownTools = stepTools(deps.registry).map((def) => def.name);
    const result = validateSkill(raw, knownTools);
    if (!result.ok) {
      return validationFailed(result.errors);
    }
    await deps.store.save(result.skill);
    deps.events.emit({ type: 'skill.saved', skillId: result.skill.id, source: 'dialog' });
    return ok(`Навык сохранён: ${result.skill.name}`, result.skill);
  });

  registry.register(listSkills, async () => {
    const skills = await deps.store.list();
    if (skills.length === 0) {
      return ok('Сохранённых навыков нет', []);
    }
    const lines = skills.map(describeSkill);
    return ok(lines.join('\n'), skills);
  });

  registry.register(getSkill, async (args) => {
    const id = args.id;
    if (typeof id !== 'string' || id.trim() === '') {
      return fail('Поле id должно быть непустой строкой');
    }
    const skill = await deps.store.get(id);
    if (skill === undefined) {
      return fail(`Навык не найден: ${id}`);
    }
    return ok(JSON.stringify(skill, null, 2), skill);
  });

  registry.register(deleteSkill, async (args) => {
    const id = args.id;
    if (typeof id !== 'string' || id.trim() === '') {
      return fail('Поле id должно быть непустой строкой');
    }
    const skill = await deps.store.get(id);
    if (skill === undefined) {
      return fail(`Навык не найден: ${id}`);
    }
    await deps.store.remove(id);
    return ok(`Навык удалён: ${skill.name}`);
  });
}
