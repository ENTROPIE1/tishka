import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEventBus } from '../src/core/events';
import { createSkillRunner, type RunResult } from '../src/core/skills/runner';
import { validateSkill } from '../src/core/skills/validate';
import { registerBuiltinTools, type BuiltinDeps } from '../src/core/tools/builtin';
import { createToolRegistry } from '../src/core/tools/registry';
import type { Skill, TishkaEvent, ToolHandler, ToolRegistry, ToolResult } from '../src/core/types';

const NOW = new Date('2026-10-03T12:34:56.000Z');

function makeSkill(overrides: Record<string, unknown> = {}): Skill {
  const result = validateSkill({
    format: 'tishka-skill/1',
    id: 'test-skill',
    name: 'Тестовый навык',
    description: '',
    phrases: ['тестовый навык'],
    trigger: { type: 'manual' },
    ...overrides
  });
  if (!result.ok) {
    throw new Error(result.errors.join('; '));
  }
  return result.skill;
}

function registryWith(handlers: Record<string, ToolHandler>): ToolRegistry {
  const registry = createToolRegistry(createEventBus());
  for (const [name, handler] of Object.entries(handlers)) {
    registry.register(
      { name, description: name, inputSchema: { type: 'object' }, source: 'builtin', readOnly: true },
      handler
    );
  }
  return registry;
}

function runnerFor(registry: ToolRegistry, ask: (prompt: string) => Promise<string>, events = createEventBus()) {
  return createSkillRunner({ registry, ask, events, now: () => NOW });
}

describe('createSkillRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('выполняет tool → ask → say по порядку и передаёт результат дальше', async () => {
    const registry = registryWith({
      fetch: async (): Promise<ToolResult> => ({ ok: true, content: 'данные', data: { n: 1 } })
    });
    const ask = vi.fn(async () => 'разбор');
    const bus = createEventBus();
    const events: TishkaEvent[] = [];
    bus.on((event) => events.push(event));

    const skill = makeSkill({
      steps: [
        { id: 'a', tool: 'fetch', args: {} },
        { id: 'b', ask: 'что тут: {{steps.a.content}}' },
        { id: 'c', say: 'Ответ: {{steps.b.content}}' }
      ]
    });

    const result = await runnerFor(registry, ask, bus).run(skill);

    expect(result.ok).toBe(true);
    expect(result.reply?.say).toBe('Ответ: разбор');
    expect(ask).toHaveBeenCalledWith('что тут: данные');
    expect(result.steps).toMatchObject({
      a: { content: 'данные', data: { n: 1 } },
      b: { content: 'разбор' },
      c: { content: 'Ответ: разбор' }
    });
    expect(events).toContainEqual({ type: 'reply', reply: { say: 'Ответ: разбор' } });
  });

  it('сбой инструмента останавливает навык, третий шаг не выполняется', async () => {
    const third = vi.fn(async (): Promise<ToolResult> => ({ ok: true, content: 'не должно' }));
    const registry = registryWith({
      first: async (): Promise<ToolResult> => ({ ok: true, content: 'ок' }),
      bad: async (): Promise<ToolResult> => ({ ok: false, content: '', error: 'сломалось' }),
      third
    });
    const bus = createEventBus();
    const events: TishkaEvent[] = [];
    bus.on((event) => events.push(event));

    const skill = makeSkill({
      steps: [
        { id: 'one', tool: 'first', args: {} },
        { id: 'two', tool: 'bad', args: {} },
        { id: 'three', tool: 'third', args: {} }
      ]
    });

    const result = await runnerFor(registry, vi.fn(), bus).run(skill);

    expect(result.ok).toBe(false);
    expect(result.failedStep).toBe('two');
    expect(result.error).toBe('сломалось');
    expect(third).not.toHaveBeenCalled();
    expect(result.steps).toMatchObject({ one: { content: 'ок' } });
    expect(result.steps).not.toHaveProperty('three');
    expect(events).toContainEqual({ type: 'error', message: 'сломалось' });
  });

  it('без обязательного входа ни один шаг не выполняется', async () => {
    const handler = vi.fn(async (): Promise<ToolResult> => ({ ok: true, content: 'ок' }));
    const registry = registryWith({ step: handler });
    const skill = makeSkill({
      inputs: [{ name: 'query', description: 'Запрос', required: true }],
      steps: [{ id: 'a', tool: 'step', args: { text: '{{inputs.query}}' } }]
    });

    const result = await runnerFor(registry, vi.fn()).run(skill);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('query');
    expect(handler).not.toHaveBeenCalled();
    expect(result.steps).toEqual({});
  });

  it('берёт недостающий вход из default', async () => {
    const registry = registryWith({
      step: async (args): Promise<ToolResult> => ({ ok: true, content: String(args.text) })
    });
    const skill = makeSkill({
      inputs: [{ name: 'who', description: 'Кому', required: true, default: 'миру' }],
      steps: [{ id: 'a', tool: 'step', args: { text: '{{inputs.who}}' } }]
    });

    const result = await runnerFor(registry, vi.fn()).run(skill);

    expect(result.ok).toBe(true);
    expect(result.steps.a.content).toBe('миру');
  });

  it('если в навыке нет say, итоговая реплика — «Готово!»', async () => {
    const registry = registryWith({
      step: async (): Promise<ToolResult> => ({ ok: true, content: 'ок' })
    });
    const skill = makeSkill({ steps: [{ id: 'a', tool: 'step', args: {} }] });

    const result = await runnerFor(registry, vi.fn()).run(skill);

    expect(result.ok).toBe(true);
    expect(result.reply?.say).toBe('Готово!');
  });

  it('готовый ответ шага-инструмента не обрывает остальные шаги навыка', async () => {
    const registry = registryWith({
      screen_look: async (): Promise<ToolResult> => ({
        ok: true,
        content: 'Открыта таблица с планом',
        reply: { say: 'Открыта таблица с планом', mood: 'neutral' }
      })
    });
    const ask = vi.fn(async () => 'на экране таблица с планом');
    const skill = makeSkill({
      steps: [
        { id: 'shot', tool: 'screen_look', args: { answer_directly: true } },
        { id: 'note', ask: 'что на экране: {{steps.shot.content}}' },
        { id: 'out', say: 'Записал: {{steps.note.content}}' }
      ]
    });

    const result = await runnerFor(registry, ask).run(skill);

    expect(result.ok).toBe(true);
    expect(result.reply?.say).toBe('Записал: на экране таблица с планом');
    expect(ask).toHaveBeenCalledWith('что на экране: Открыта таблица с планом');
  });

  it('пресет friday-morning вызывает open_urls один раз и возвращает свою реплику', async () => {
    const raw = readFileSync(new URL('../presets/friday-morning.tishka.json', import.meta.url), 'utf8');
    const validated = validateSkill(JSON.parse(raw) as unknown, ['open_urls']);
    if (!validated.ok) {
      throw new Error(validated.errors.join('; '));
    }

    const registry = createToolRegistry(createEventBus());
    const openExternal = vi.fn(async () => undefined);
    const deps: BuiltinDeps = { openExternal, showPanel: vi.fn(), now: () => NOW };
    registerBuiltinTools(registry, deps);
    const callSpy = vi.spyOn(registry, 'call');

    const result: RunResult = await runnerFor(registry, vi.fn()).run(validated.skill);

    expect(result.ok).toBe(true);
    expect(result.reply?.say).toBe('Открыл всё для пятницы');
    expect(callSpy).toHaveBeenCalledTimes(1);
    expect(callSpy).toHaveBeenCalledWith('open_urls', {
      urls: ['https://example.org/friday', 'https://example.org/plan']
    });
    expect(openExternal).toHaveBeenCalledTimes(2);
  });
});
