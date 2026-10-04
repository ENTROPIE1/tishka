import { describe, expect, it } from 'vitest';
import { skillGuide } from '../src/core/agent/skill-guide';
import { createEventBus } from '../src/core/events';
import { registerSkillTools, type SkillToolsStore } from '../src/core/skills/tools';
import { validateSkill } from '../src/core/skills/validate';
import { createToolRegistry } from '../src/core/tools/registry';
import type { Skill, TishkaEvent, ToolDef, ToolRegistry, ToolResult } from '../src/core/types';

function makeStore(): SkillToolsStore & { saved: Map<string, Skill> } {
  const saved = new Map<string, Skill>();
  return {
    saved,
    list: async () => [...saved.values()],
    get: async (id: string) => saved.get(id),
    save: async (skill: Skill) => {
      saved.set(skill.id, skill);
    },
    remove: async (id: string) => {
      saved.delete(id);
    }
  };
}

const openUrlsDef: ToolDef = {
  name: 'open_urls',
  description: 'Открывает несколько ссылок по очереди.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  source: 'builtin',
  readOnly: false
};

const confluenceDef: ToolDef = {
  name: 'confluence__get_page_version',
  description: 'Возвращает страницу конфлюенса и её версию.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  source: 'mcp:confluence',
  readOnly: true
};

function makeSetup(): {
  registry: ToolRegistry;
  store: ReturnType<typeof makeStore>;
  events: TishkaEvent[];
  call: (name: string, args: Record<string, unknown>) => Promise<ToolResult>;
} {
  const bus = createEventBus();
  const registry = createToolRegistry(bus);
  const store = makeStore();
  const events: TishkaEvent[] = [];
  bus.on((event) => events.push(event));

  registry.register(openUrlsDef, async () => ({ ok: true, content: 'открыл' }));
  registry.register(confluenceDef, async () => ({ ok: true, content: 'страница' }));
  registry.register(
    { ...openUrlsDef, name: 'skill__demo', description: 'Навык как инструмент' },
    async () => ({ ok: true, content: 'навык' })
  );

  registerSkillTools(registry, { store, registry, events: bus });

  return {
    registry,
    store,
    events,
    call: (name, args) => registry.call(name, args)
  };
}

function manualSkill(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: 'tishka-skill/1',
    id: 'morning-links',
    name: 'Утренние ссылки',
    description: 'Открывает рабочие ссылки',
    phrases: ['утренние ссылки'],
    trigger: { type: 'manual' },
    steps: [
      { id: 'open', tool: 'open_urls', args: { urls: ['https://example.org'] } },
      { id: 'done', say: 'Открыл ссылки' }
    ],
    ...overrides
  };
}

function savedEvents(events: TishkaEvent[]): TishkaEvent[] {
  return events.filter((event) => event.type === 'skill.saved');
}

describe('save_skill', () => {
  it('правильный навык сохранён, событие skill.saved отправлено', async () => {
    const { call, store, events } = makeSetup();

    const result = await call('save_skill', { skill: manualSkill() });

    expect(result.ok).toBe(true);
    expect(result.content).toContain('Навык сохранён: Утренние ссылки');
    expect(store.saved.has('morning-links')).toBe(true);
    expect(savedEvents(events)).toEqual([{ type: 'skill.saved', skillId: 'morning-links', source: 'dialog' }]);
  });

  it('неизвестный инструмент в шаге: ok false, ошибка в content, навыка и события нет', async () => {
    const { call, store, events } = makeSetup();
    const skill = manualSkill({
      steps: [{ id: 'open', tool: 'mystery', args: {} }]
    });

    const result = await call('save_skill', { skill });

    expect(result.ok).toBe(false);
    expect(result.content).toContain('mystery');
    expect(store.saved.size).toBe(0);
    expect(savedEvents(events)).toEqual([]);
  });

  it('инструменты навыков и мастер навыков запрещены в шагах', async () => {
    const { call, store } = makeSetup();

    const asSkillStep = await call('save_skill', {
      skill: manualSkill({ steps: [{ id: 'a', tool: 'skill__demo', args: {} }] })
    });
    const wizardStep = await call('save_skill', {
      skill: manualSkill({ steps: [{ id: 'a', tool: 'get_skill', args: {} }] })
    });

    expect(asSkillStep.ok).toBe(false);
    expect(asSkillStep.content).toContain('skill__demo');
    expect(wizardStep.ok).toBe(false);
    expect(wizardStep.content).toContain('get_skill');
    expect(store.saved.size).toBe(0);
  });

  it('поле token отклоняется', async () => {
    const { call, store, events } = makeSetup();

    const result = await call('save_skill', { skill: manualSkill({ token: 'значение' }) });

    expect(result.ok).toBe(false);
    expect(result.content).toContain('token');
    expect(store.saved.size).toBe(0);
    expect(savedEvents(events)).toEqual([]);
  });

  it('повторное сохранение с тем же id заменяет навык', async () => {
    const { call, store, events } = makeSetup();

    await call('save_skill', { skill: manualSkill() });
    await call('save_skill', { skill: manualSkill({ name: 'Ссылки на утро' }) });

    expect(store.saved.size).toBe(1);
    expect(store.saved.get('morning-links')?.name).toBe('Ссылки на утро');
    expect(savedEvents(events)).toEqual([
      { type: 'skill.saved', skillId: 'morning-links', source: 'dialog' },
      { type: 'skill.saved', skillId: 'morning-links', source: 'dialog' }
    ]);
  });

  it('навык не-объект отклоняется', async () => {
    const { call } = makeSetup();

    const result = await call('save_skill', { skill: 'строка' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('skill');
  });
});

describe('list_skills, get_skill, delete_skill', () => {
  it('list_skills показывает id, название, фразы и вид триггера', async () => {
    const { call } = makeSetup();
    const saved = validateSkill(manualSkill());
    const watch = validateSkill(
      manualSkill({
        id: 'page-watch',
        phrases: [],
        trigger: { type: 'watch', tool: 'confluence__get_page_version', args: { page_id: 1 }, everyMinutes: 2 }
      })
    );
    if (!saved.ok || !watch.ok) {
      throw new Error('тестовые навыки невалидны');
    }
    await call('save_skill', { skill: saved.skill });
    await call('save_skill', { skill: watch.skill });

    const result = await call('list_skills', {});

    expect(result.ok).toBe(true);
    expect(result.content).toContain('morning-links');
    expect(result.content).toContain('утренние ссылки');
    expect(result.content).toContain('ручной запуск');
    expect(result.content).toContain('page-watch');
    expect(result.content).toContain('наблюдение');
  });

  it('get_skill возвращает полный навык, для неизвестного id — ok false', async () => {
    const { call, store } = makeSetup();
    const saved = validateSkill(manualSkill());
    if (!saved.ok) {
      throw new Error('тестовый навык невалиден');
    }
    store.saved.set('morning-links', saved.skill);

    const found = await call('get_skill', { id: 'morning-links' });
    const missing = await call('get_skill', { id: 'nope' });

    expect(found.ok).toBe(true);
    expect(found.content).toContain('"format": "tishka-skill/1"');
    expect(found.content).toContain('morning-links');
    expect(missing.ok).toBe(false);
    expect(missing.error).toContain('не найден');
  });

  it('delete_skill удаляет навык', async () => {
    const { call, store } = makeSetup();
    const saved = validateSkill(manualSkill());
    if (!saved.ok) {
      throw new Error('тестовый навык невалиден');
    }
    store.saved.set('morning-links', saved.skill);

    const result = await call('delete_skill', { id: 'morning-links' });

    expect(result.ok).toBe(true);
    expect(store.saved.size).toBe(0);
    await expect(call('get_skill', { id: 'morning-links' })).resolves.toMatchObject({ ok: false });
  });
});

describe('skillGuide', () => {
  const TOOLS = [openUrlsDef, confluenceDef];

  it('содержит имена переданных инструментов и оба примера', () => {
    const guide = skillGuide(TOOLS);

    for (const tool of TOOLS) {
      expect(guide).toContain(tool.name);
    }
    expect(guide).toContain('```json');
    const blocks = [...guide.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => match[1]);
    expect(blocks).toHaveLength(2);
  });

  it('оба примера проходят validateSkill', () => {
    const guide = skillGuide(TOOLS);
    const blocks = [...guide.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => match[1]);
    const knownTools = TOOLS.map((tool) => tool.name);

    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      const parsed: unknown = JSON.parse(block);
      const result = validateSkill(parsed, knownTools);
      expect(result.ok).toBe(true);
    }
  });

  it('в примерах есть навык по фразе и навык с наблюдением', () => {
    const guide = skillGuide(TOOLS);
    const blocks = [...guide.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => match[1]);
    const parsed = blocks.map((block) => JSON.parse(block) as { trigger: { type: string } });

    expect(parsed.map((skill) => skill.trigger.type).sort()).toEqual(['manual', 'watch']);
  });

  it('guide упоминает порядок работы и правила', () => {
    const guide = skillGuide(TOOLS);

    expect(guide).toContain('save_skill');
    expect(guide).toContain('не больше трёх');
    expect(guide).toContain('латиницей');
    expect(guide).toContain('секреты');
    expect(guide).toContain('ошибки');
  });

  it('guide содержит правило о согласии перед сохранением', () => {
    const guide = skillGuide(TOOLS);

    expect(guide).toContain('«Сохраняю?»');
    expect(guide).toContain('следующее сообщение');
    expect(guide).toContain('в одном ходе');
    expect(guide).toContain('поправь навык');
  });

  it('guide требует выносить числа из подстановок в show шага say', () => {
    const guide = skillGuide(TOOLS);
    const blocks = [...guide.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => match[1]);
    const parsed = blocks.map((block) => JSON.parse(block) as { steps: { say?: string; show?: object }[] });
    const watchSkill = parsed.find((skill) => 'steps' in skill && skill.steps.some((step) => 'show' in step));

    expect(watchSkill).toBeDefined();
    for (const step of watchSkill?.steps ?? []) {
      if (step.show !== undefined) {
        expect(step.say).not.toMatch(/\{\{/);
      }
    }
  });
});
