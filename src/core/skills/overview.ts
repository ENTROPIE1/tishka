import type { Skill, ToolDef, ToolRegistry, ToolResult } from '../types';
import type { SkillRunState, TriggerState } from '../triggers/state';
import { describeSkill, type SkillDescription } from './describe';

export interface SkillOverview {
  skill: Skill;
  description: SkillDescription;
  state: SkillRunState;
}

export interface SkillOverviewDeps {
  store: { list(): Promise<Skill[]> };
  state: { load(): Promise<TriggerState> };
  tools: () => ToolDef[];
}

export interface SkillOverviewService {
  list(): Promise<SkillOverview[]>;
}

export function createSkillOverview(deps: SkillOverviewDeps): SkillOverviewService {
  return {
    async list(): Promise<SkillOverview[]> {
      const skills = await deps.store.list();
      const state = await deps.state.load();
      const tools = deps.tools();
      return skills.map((skill) => ({
        skill,
        description: describeSkill(skill, tools),
        state: state.skills?.[skill.id] ?? { runCount: 0 }
      }));
    }
  };
}

const overviewTool: ToolDef = {
  name: 'skills_overview',
  description:
    'Показывает навыки и автоматизации человека с их состоянием: что делают, когда запускаются и как давно работали. Вызывай, когда спрашивают про автоматизации, наблюдения или что Тишка отслеживает.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  source: 'builtin',
  readOnly: true
};

function stateText(state: SkillRunState, enabled: boolean): string {
  if (!enabled) {
    return 'выключен';
  }
  if (state.lastResult !== undefined && state.lastResult !== 'ok') {
    return `ошибка: ${state.lastResult}`;
  }
  const ran = state.runCount > 0 ? `срабатывал ${state.runCount} раз` : 'ещё не срабатывал';
  const next = state.nextAt === undefined ? '' : `, следующий ${state.nextAt}`;
  return `${ran}${next}`;
}

function describeLine(entry: SkillOverview): string {
  const { skill, description, state } = entry;
  const does = description.does.join('; ');
  return `${skill.name} [${description.kind}] — когда: ${description.when}. Что делает: ${does}. Состояние: ${stateText(
    state,
    skill.enabled !== false
  )}`;
}

export function registerOverviewTools(registry: ToolRegistry, overview: SkillOverviewService): void {
  registry.register(overviewTool, async (): Promise<ToolResult> => {
    const entries = await overview.list();
    if (entries.length === 0) {
      return { ok: true, content: 'Навыков и автоматизаций нет', data: entries };
    }
    return { ok: true, content: entries.map(describeLine).join('\n'), data: entries };
  });
}
