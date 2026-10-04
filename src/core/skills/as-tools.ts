import type { Skill, ToolDef, ToolRegistry, ToolResult } from '../types';
import type { RunResult } from './runner';

export interface SkillToolRunner {
  run(skill: Skill, inputs?: Record<string, unknown>): Promise<RunResult>;
}

function skillDescription(skill: Skill): string {
  const parts = [skill.name];
  if (skill.description !== '') {
    parts.push(skill.description);
  }
  if (skill.phrases.length > 0) {
    parts.push(`Фразы вызова: ${skill.phrases.join(', ')}`);
  }
  return parts.join('. ');
}

function inputSchema(skill: Skill): object {
  const properties: Record<string, { type: 'string'; description?: string }> = {};
  const required: string[] = [];

  for (const input of skill.inputs ?? []) {
    properties[input.name] =
      input.description === '' ? { type: 'string' } : { type: 'string', description: input.description };
    if (input.required && input.default === undefined) {
      required.push(input.name);
    }
  }

  return { type: 'object', properties, required, additionalProperties: false };
}

async function runSkill(
  skill: Skill,
  runner: SkillToolRunner,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const result = await runner.run(skill, args);
  if (result.ok) {
    return { ok: true, content: result.reply?.say ?? 'Готово', data: result.steps };
  }
  const error = result.error ?? 'Навык не выполнился';
  return { ok: false, content: error, data: result.steps, error: result.error };
}

export function syncSkillTools(registry: ToolRegistry, skills: Skill[], runner: SkillToolRunner): void {
  registry.unregisterSource('skill');

  for (const skill of skills) {
    if (skill.trigger.type !== 'manual' || skill.enabled === false) {
      continue;
    }
    const def: ToolDef = {
      name: `skill__${skill.id}`,
      description: skillDescription(skill),
      inputSchema: inputSchema(skill),
      source: 'skill',
      readOnly: false
    };
    registry.register(def, (args) => runSkill(skill, runner, args));
  }
}
