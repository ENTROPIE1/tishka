import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cronWords, describeSkill } from '../src/core/skills/describe';
import { validateSkill } from '../src/core/skills/validate';
import type { Skill, ToolDef } from '../src/core/types';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const presetsDir = join(root, 'presets');

const tools: ToolDef[] = [
  {
    name: 'open_urls',
    description: 'Открывает несколько ссылок по очереди, когда пользователю нужен набор страниц за один раз.',
    inputSchema: { type: 'object' },
    source: 'builtin',
    readOnly: false
  }
];

function presetSkills(): Skill[] {
  return readdirSync(presetsDir)
    .filter((name) => name.endsWith('.tishka.json'))
    .map((name) => {
      const raw = JSON.parse(readFileSync(join(presetsDir, name), 'utf8')) as unknown;
      const result = validateSkill(raw);
      if (!result.ok) {
        throw new Error(`${name}: ${result.errors.join('; ')}`);
      }
      return result.skill;
    });
}

describe('cronWords', () => {
  it('переводит будни и время', () => {
    expect(cronWords('30 9 * * 1-5')).toBe('по будням в 9:30');
  });

  it('переводит каждый день и интервалы', () => {
    expect(cronWords('0 8 * * *')).toBe('каждый день в 8:00');
    expect(cronWords('*/15 * * * *')).toBe('каждые 15 минут');
    expect(cronWords('0 */2 * * *')).toBe('каждые 2 часа');
  });

  it('непонятное выражение возвращает как есть', () => {
    expect(cronWords('0 0 1 * *')).toBe('0 0 1 * *');
    expect(cronWords('кривое')).toBe('кривое');
  });
});

describe('describeSkill', () => {
  it('для каждого пресета when и does непустые, kind верный', () => {
    for (const skill of presetSkills()) {
      const description = describeSkill(skill, tools);
      expect(description.title, skill.id).toBe(skill.name);
      expect(description.when, skill.id).not.toBe('');
      expect(description.does.length, skill.id).toBeGreaterThan(0);
      const expected = skill.trigger.type === 'manual' ? 'phrase' : skill.trigger.type;
      expect(description.kind, skill.id).toBe(expected);
    }
  });

  it('навык по фразе описывает when и needs', () => {
    const skill = presetSkills().find((item) => item.id === 'page-changes');
    if (skill === undefined) {
      throw new Error('нет пресета page-changes');
    }
    const description = describeSkill(skill);
    expect(description.when).toContain('По фразе');
    expect(description.needs).toEqual(['Confluence']);
    expect(description.inputs.length).toBeGreaterThan(0);
  });

  it('шаг с известным инструментом берёт первое предложение описания', () => {
    const skill: Skill = {
      format: 'tishka-skill/1',
      id: 'demo',
      name: 'Демо',
      description: '',
      phrases: ['демо'],
      trigger: { type: 'manual' },
      steps: [
        { id: 'open', tool: 'open_urls', args: {} },
        { id: 'ask', ask: 'собери сводку' },
        { id: 'say', say: 'Готово' }
      ]
    };
    const description = describeSkill(skill, tools);
    expect(description.does[0]).toBe('Открывает несколько ссылок по очереди, когда пользователю нужен набор страниц за один раз.');
    expect(description.does[1]).toContain('Просит модель:');
    expect(description.does[2]).toBe('Говорит: Готово');
  });

  it('неизвестный инструмент описывается запасной фразой', () => {
    const skill: Skill = {
      format: 'tishka-skill/1',
      id: 'demo',
      name: 'Демо',
      description: '',
      phrases: [],
      trigger: { type: 'watch', tool: 'mystery', args: {}, everyMinutes: 15 },
      steps: [{ id: 'a', tool: 'mystery', args: {} }]
    };
    const description = describeSkill(skill);
    expect(description.does[0]).toBe('Вызывает mystery');
    expect(description.when).toContain('каждые 15 минут');
    expect(description.kind).toBe('watch');
  });
});
