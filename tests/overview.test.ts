import { describe, expect, it } from 'vitest';
import { createEventBus } from '../src/core/events';
import { createSkillOverview, registerOverviewTools } from '../src/core/skills/overview';
import { validateSkill } from '../src/core/skills/validate';
import { createToolRegistry } from '../src/core/tools/registry';
import { emptyTriggerState, type TriggerState } from '../src/core/triggers/state';
import type { Skill, ToolDef } from '../src/core/types';

const openUrls: ToolDef = {
  name: 'open_urls',
  description: 'Открывает несколько ссылок по очереди, когда пользователю нужен набор страниц.',
  inputSchema: { type: 'object' },
  source: 'builtin',
  readOnly: false
};

function skill(overrides: Record<string, unknown> = {}): Skill {
  const result = validateSkill({
    format: 'tishka-skill/1',
    id: 'morning',
    name: 'Утро',
    description: 'Открывает ссылки',
    phrases: ['утро'],
    trigger: { type: 'manual' },
    steps: [{ id: 'open', tool: 'open_urls', args: {} }],
    ...overrides
  });
  if (!result.ok) {
    throw new Error(result.errors.join('; '));
  }
  return result.skill;
}

function makeOverview(skills: Skill[], state: TriggerState) {
  return createSkillOverview({
    store: { list: async () => skills },
    state: { load: async () => state },
    tools: () => [openUrls]
  });
}

describe('createSkillOverview', () => {
  it('собирает навык, описание и состояние запусков', async () => {
    const state = emptyTriggerState();
    state.skills = {
      morning: { runCount: 3, lastResult: 'ok', lastRunAt: '2026-10-05T09:00:00.000Z', nextAt: '2026-10-05T10:00:00.000Z' }
    };
    const overview = makeOverview([skill()], state);

    const [entry] = await overview.list();

    expect(entry.skill.id).toBe('morning');
    expect(entry.description.kind).toBe('phrase');
    expect(entry.description.does[0]).toContain('Открывает несколько ссылок');
    expect(entry.state.runCount).toBe(3);
  });

  it('без состояния отдаёт нулевой счётчик', async () => {
    const overview = makeOverview([skill()], emptyTriggerState());

    const [entry] = await overview.list();

    expect(entry.state).toEqual({ runCount: 0 });
  });
});

describe('registerOverviewTools', () => {
  it('skills_overview — встроенный инструмент со списком и состоянием', async () => {
    const state = emptyTriggerState();
    state.skills = { morning: { runCount: 1, lastResult: 'ok' } };
    const registry = createToolRegistry(createEventBus());
    registerOverviewTools(registry, makeOverview([skill()], state));

    const def = registry.list().find((item) => item.name === 'skills_overview');
    expect(def?.source).toBe('builtin');

    const result = await registry.call('skills_overview', {});

    expect(result.ok).toBe(true);
    expect(result.content).toContain('Утро');
    expect(result.content).toContain('По фразе');
    expect(result.content).toContain('срабатывал 1 раз');
  });

  it('показывает выключенный навык', async () => {
    const registry = createToolRegistry(createEventBus());
    registerOverviewTools(registry, makeOverview([skill({ enabled: false })], emptyTriggerState()));

    const result = await registry.call('skills_overview', {});

    expect(result.content).toContain('выключен');
  });

  it('пустой список даёт понятный ответ', async () => {
    const registry = createToolRegistry(createEventBus());
    registerOverviewTools(registry, makeOverview([], emptyTriggerState()));

    const result = await registry.call('skills_overview', {});

    expect(result.content).toContain('нет');
  });
});
