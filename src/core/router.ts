import type { EventBus, Reply, Skill, ToolRegistry } from './types';
import { syncSkillTools, type SkillToolRunner } from './skills/as-tools';
import { matchSkill } from './skills/match';
import type { RunResult } from './skills/runner';

export interface RouterDeps {
  agent: { handle(userText: string): Promise<Reply> };
  skills: { list(): Promise<Skill[]> };
  runner: SkillToolRunner;
  registry: ToolRegistry;
  events: EventBus;
}

export interface Router {
  handle(userText: string): Promise<Reply>;
  refreshSkills(): Promise<void>;
}

function runsWithoutInputs(skill: Skill): boolean {
  return (skill.inputs ?? []).every((input) => !input.required || input.default !== undefined);
}

export function createRouter(deps: RouterDeps): Router {
  async function refreshSkills(): Promise<void> {
    syncSkillTools(deps.registry, await deps.skills.list(), deps.runner);
  }

  deps.events.on((event) => {
    if (event.type === 'skill.saved') {
      void refreshSkills();
    }
  });

  async function handle(userText: string): Promise<Reply> {
    const enabled = (await deps.skills.list()).filter((item) => item.enabled !== false);
    const skill = matchSkill(userText, enabled);
    if (skill === undefined || !runsWithoutInputs(skill)) {
      return deps.agent.handle(userText);
    }

    const result: RunResult = await deps.runner.run(skill);
    if (result.ok) {
      return result.reply ?? { say: 'Готово!' };
    }
    return { say: result.error ?? 'Не получилось выполнить навык', mood: 'confused' };
  }

  return { handle, refreshSkills };
}
