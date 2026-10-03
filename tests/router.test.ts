import { describe, expect, it, vi } from 'vitest';
import { createEventBus } from '../src/core/events';
import { createRouter } from '../src/core/router';
import { syncSkillTools } from '../src/core/skills/as-tools';
import type { RunResult } from '../src/core/skills/runner';
import { createToolRegistry } from '../src/core/tools/registry';
import type { Reply, Skill } from '../src/core/types';

function makeSkill(id: string, phrases: string[], extra: Partial<Skill> = {}): Skill {
  return {
    format: 'tishka-skill/1',
    id,
    name: `Навык ${id}`,
    description: 'тестовое описание',
    phrases,
    trigger: { type: 'manual' },
    steps: [{ id: 'done', say: 'ок' }],
    ...extra
  };
}

function runnerReturning(say: string) {
  return vi.fn(async (): Promise<RunResult> => ({ ok: true, reply: { say }, steps: { done: { content: say } } }));
}

function fakeStore(initial: Skill[]) {
  let skills = initial;
  return {
    list: vi.fn(async (): Promise<Skill[]> => skills),
    set(next: Skill[]): void {
      skills = next;
    }
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('syncSkillTools', () => {
  it('регистрирует ручной навык как skill__<id> со схемой входов', () => {
    const registry = createToolRegistry(createEventBus());
    const manual = makeSkill('friday', ['утро пятницы'], {
      inputs: [
        { name: 'note', description: 'Заметка', required: true },
        { name: 'who', description: 'Кому', required: true, default: 'миру' }
      ]
    });
    const scheduled = makeSkill('night', ['ночь'], { trigger: { type: 'schedule', cron: '0 23 * * *' } });

    syncSkillTools(registry, [manual, scheduled], { run: runnerReturning('ок') });

    const names = registry.list().map((def) => def.name);
    expect(names).toContain('skill__friday');
    expect(names).not.toContain('skill__night');

    const def = registry.list().find((item) => item.name === 'skill__friday');
    expect(def).toBeDefined();
    expect(def?.source).toBe('skill');
    expect(def?.readOnly).toBe(false);
    expect(def?.inputSchema).toMatchObject({
      type: 'object',
      properties: { note: { type: 'string' }, who: { type: 'string' } },
      required: ['note']
    });
    expect(def?.description).toContain('Навык friday');
    expect(def?.description).toContain('утро пятницы');
  });

  it('повторный вызов не оставляет инструментов удалённых навыков', () => {
    const registry = createToolRegistry(createEventBus());
    const runner = { run: runnerReturning('ок') };

    syncSkillTools(registry, [makeSkill('a', ['а'])], runner);
    syncSkillTools(registry, [makeSkill('b', ['б'])], runner);

    expect(registry.list().map((def) => def.name)).toEqual(['skill__b']);
  });

  it('вызов skill__<id> через реестр запускает навык с переданными входами', async () => {
    const registry = createToolRegistry(createEventBus());
    const run = vi.fn(async (): Promise<RunResult> => ({
      ok: true,
      reply: { say: 'готово' },
      steps: { done: { content: 'готово' } }
    }));
    const skill = makeSkill('friday', ['утро']);

    syncSkillTools(registry, [skill], { run });

    const result = await registry.call('skill__friday', { note: 'привет' });

    expect(run).toHaveBeenCalledWith(skill, { note: 'привет' });
    expect(result).toEqual({ ok: true, content: 'готово', data: { done: { content: 'готово' } } });
  });
});

describe('createRouter', () => {
  function setup(skills: Skill[]) {
    const bus = createEventBus();
    const registry = createToolRegistry(bus);
    const store = fakeStore(skills);
    const run = runnerReturning('Открыл всё для пятницы');
    const agent = { handle: vi.fn(async (_text: string): Promise<Reply> => ({ say: 'ответ агента' })) };
    const router = createRouter({ agent, skills: store, runner: { run }, registry, events: bus });
    return { bus, registry, store, run, agent, router };
  }

  it('точное совпадение запускает навык, агент не вызывается', async () => {
    const { run, agent, router } = setup([makeSkill('friday', ['утро пятницы'])]);

    const reply = await router.handle('Утро пятницы!');

    expect(reply.say).toBe('Открыл всё для пятницы');
    expect(run).toHaveBeenCalledOnce();
    expect(agent.handle).not.toHaveBeenCalled();
  });

  it('нет совпадения — вызывается агент, навык не запускается', async () => {
    const { run, agent, router } = setup([makeSkill('friday', ['утро пятницы'])]);

    const reply = await router.handle('расскажи анекдот');

    expect(reply.say).toBe('ответ агента');
    expect(run).not.toHaveBeenCalled();
    expect(agent.handle).toHaveBeenCalledWith('расскажи анекдот');
  });

  it('навык с обязательным входом без значения по умолчанию уходит агенту', async () => {
    const skill = makeSkill('find', ['найди'], {
      inputs: [{ name: 'query', description: '', required: true }]
    });
    const { run, agent, router } = setup([skill]);

    const reply = await router.handle('найди');

    expect(reply.say).toBe('ответ агента');
    expect(run).not.toHaveBeenCalled();
    expect(agent.handle).toHaveBeenCalledOnce();
  });

  it('сбой навыка возвращает понятную фразу и mood confused', async () => {
    const { run, router } = setup([makeSkill('friday', ['утро пятницы'])]);
    run.mockResolvedValueOnce({ ok: false, error: 'сломалось', steps: {} });

    const reply = await router.handle('утро пятницы');

    expect(reply.say).toContain('сломалось');
    expect(reply.mood).toBe('confused');
  });

  it('после события skill.saved новый навык доступен как инструмент', async () => {
    const { bus, registry, store, router } = setup([]);
    await router.refreshSkills();
    expect(registry.list()).toEqual([]);

    store.set([makeSkill('new', ['новый'])]);
    bus.emit({ type: 'skill.saved', skillId: 'new' });
    await flush();

    expect(registry.list().map((def) => def.name)).toContain('skill__new');
  });
});
