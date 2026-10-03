import { readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  readFile: vi.fn(),
  readdir: vi.fn(),
  rename: vi.fn(),
  unlink: vi.fn(),
  writeFile: vi.fn()
}));

import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { createSkillStore, SkillValidationError } from '../src/core/skills/store';
import { validateSkill } from '../src/core/skills/validate';
import type { Skill } from '../src/core/types';

const mockedMkdir = vi.mocked(mkdir);
const mockedReadFile = vi.mocked(readFile);
const mockedReaddir = vi.mocked(readdir);
const mockedRename = vi.mocked(rename);
const mockedUnlink = vi.mocked(unlink);
const mockedWriteFile = vi.mocked(writeFile);

const files = new Map<string, string>();
const skillsDir = 'C:/tishka-data/skills';
const presetsDir = 'C:/tishka/presets';

function parsePreset(): unknown {
  const raw = readFileSync(new URL('../presets/friday-morning.tishka.json', import.meta.url), 'utf8');
  return JSON.parse(raw) as unknown;
}

function baseSkill(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: 'tishka-skill/1',
    id: 'test-skill',
    name: 'Тестовый навык',
    description: 'Описание',
    phrases: ['тестовый навык'],
    trigger: { type: 'manual' },
    steps: [{ id: 'done', say: 'Готово' }],
    ...overrides
  };
}

function errorText(input: unknown, knownTools?: string[]): string[] {
  const result = validateSkill(input, knownTools);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.errors;
}

beforeEach(() => {
  vi.clearAllMocks();
  files.clear();

  mockedMkdir.mockResolvedValue(undefined as never);
  mockedWriteFile.mockImplementation(async (path, data) => {
    files.set(String(path), String(data));
    return undefined as never;
  });
  mockedRename.mockImplementation(async (from, to) => {
    const data = files.get(String(from));
    files.delete(String(from));
    if (data !== undefined) {
      files.set(String(to), data);
    }
    return undefined as never;
  });
  mockedUnlink.mockImplementation(async (path) => {
    files.delete(String(path));
    return undefined as never;
  });
  mockedReadFile.mockImplementation(async (path) => {
    const data = files.get(String(path));
    if (data === undefined) {
      throw new Error('ENOENT');
    }
    return data as never;
  });
  mockedReaddir.mockImplementation(async (path) => {
    const directory = normalize(String(path));
    const entries: { name: string; isFile: () => boolean }[] = [];
    for (const filePath of files.keys()) {
      if (dirname(filePath) === directory) {
        entries.push({ name: filePath.slice(directory.length + 1), isFile: () => true });
      }
    }
    return entries as never;
  });
});

describe('validateSkill', () => {
  it('пресет friday-morning проходит проверку', () => {
    const result = validateSkill(parsePreset(), ['open_urls']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.skill.id).toBe('friday-morning');
      expect(result.skill.name).toBe('Утро пятницы');
      expect(result.skill.phrases).toEqual(['утро пятницы', 'начинаем пятницу']);
      expect(result.skill.steps).toHaveLength(2);
    }
  });

  it('отклоняет неверный format', () => {
    expect(errorText(baseSkill({ format: 'other/1' })).join('\n')).toContain('format');
  });

  it('отклоняет неверный id', () => {
    expect(errorText(baseSkill({ id: 'плохой id!' })).join('\n')).toContain('id');
  });

  it('отклоняет пустое имя', () => {
    expect(errorText(baseSkill({ name: '   ' })).join('\n')).toContain('name');
  });

  it('отклоняет phrases не массив строк', () => {
    expect(errorText(baseSkill({ phrases: 'утро' })).join('\n')).toContain('phrases');
  });

  it('требует фразу для manual', () => {
    expect(errorText(baseSkill({ phrases: [] })).join('\n')).toContain('фраз');
  });

  it('отклоняет неизвестный trigger', () => {
    expect(errorText(baseSkill({ trigger: { type: 'unknown' } })).join('\n')).toContain('trigger');
  });

  it('требует ровно одно из at и cron', () => {
    const both = baseSkill({ trigger: { type: 'schedule', at: '2026-01-01T00:00:00Z', cron: '* * * * *' } });
    expect(errorText(both).join('\n')).toContain('at и cron');
    const none = baseSkill({ trigger: { type: 'schedule' } });
    expect(errorText(none).join('\n')).toContain('at и cron');
  });

  it('требует everyMinutes не меньше 1', () => {
    const watch = baseSkill({
      trigger: { type: 'watch', tool: 'get_time', args: {}, everyMinutes: 0 }
    });
    expect(errorText(watch).join('\n')).toContain('everyMinutes');
  });

  it('отклоняет пустой steps', () => {
    expect(errorText(baseSkill({ steps: [] })).join('\n')).toContain('steps');
  });

  it('отклоняет повторяющиеся id шагов', () => {
    const skill = baseSkill({
      steps: [
        { id: 'a', say: 'раз' },
        { id: 'a', say: 'два' }
      ]
    });
    expect(errorText(skill).join('\n')).toContain('повтор');
  });

  it('требует ровно один вид шага', () => {
    const skill = baseSkill({ steps: [{ id: 'a', tool: 'get_time', ask: 'вопрос' }] });
    expect(errorText(skill).join('\n')).toContain('одного вида');
  });

  it('отклоняет подстановку на несуществующий шаг', () => {
    const skill = baseSkill({ steps: [{ id: 'a', say: '{{steps.b.content}}' }] });
    expect(errorText(skill).join('\n')).toContain('steps.b');
  });

  it('отклоняет подстановку вперёд', () => {
    const skill = baseSkill({
      steps: [
        { id: 'a', say: '{{steps.b.content}}' },
        { id: 'b', say: '{{steps.a.content}}' }
      ]
    });
    const errors = errorText(skill).join('\n');
    expect(errors).toContain('steps.b');
    expect(errors).not.toContain('steps.a');
  });

  it('отклоняет подстановку на необъявленный вход', () => {
    const skill = baseSkill({ steps: [{ id: 'a', say: '{{inputs.nope}}' }] });
    expect(errorText(skill).join('\n')).toContain('inputs.nope');
  });

  it('пропускает подстановки на объявленный вход и прошлый шаг', () => {
    const skill = baseSkill({
      inputs: [{ name: 'query', description: 'Запрос', required: true }],
      steps: [
        { id: 'a', tool: 'get_time', args: {} },
        { id: 'b', say: '{{inputs.query}} {{steps.a.content}}' }
      ]
    });
    expect(validateSkill(skill).ok).toBe(true);
  });

  it('проверяет инструмент по knownTools', () => {
    const skill = baseSkill({ steps: [{ id: 'a', tool: 'mystery', args: {} }] });
    expect(errorText(skill, ['get_time']).join('\n')).toContain('mystery');
  });

  it('отклоняет ссылку на секрет', () => {
    const skill = baseSkill({ steps: [{ id: 'a', say: '${secret:TOKEN}' }] });
    expect(errorText(skill).join('\n')).toContain('секрет');
  });

  it('отклоняет поле token', () => {
    expect(errorText(baseSkill({ token: 'значение' })).join('\n')).toContain('token');
  });
});

describe('createSkillStore', () => {
  it('сохранил → прочитал → получил тот же навык', async () => {
    const store = createSkillStore(skillsDir);
    const result = validateSkill(parsePreset());
    if (!result.ok) {
      throw new Error('пресет невалиден');
    }

    await store.save(result.skill);

    await expect(store.get('friday-morning')).resolves.toEqual(result.skill);
    await expect(store.list()).resolves.toEqual([result.skill]);
  });

  it('отклоняет сохранение невалидного навыка', async () => {
    const store = createSkillStore(skillsDir);
    const invalid = baseSkill({ id: 'bad id!' }) as unknown as Skill;

    await expect(store.save(invalid)).rejects.toBeInstanceOf(SkillValidationError);
    expect(files.size).toBe(0);
  });

  it('импорт файла с занятым id добавляет суффикс', async () => {
    const preset = JSON.stringify(parsePreset());
    files.set(join(skillsDir, 'friday-morning.tishka.json'), preset);
    const importPath = 'C:/incoming/friday-morning.tishka.json';
    files.set(importPath, preset);

    const store = createSkillStore(skillsDir);
    const result = await store.importFile(importPath);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.skill.id).toBe('friday-morning-2');
    }
    expect(files.has(join(skillsDir, 'friday-morning-2.tishka.json'))).toBe(true);
  });

  it('импорт файла с полем token отклоняется', async () => {
    const preset = parsePreset() as Record<string, unknown>;
    files.set('C:/incoming/bad.tishka.json', JSON.stringify({ ...preset, token: 'значение' }));

    const store = createSkillStore(skillsDir);
    const result = await store.importFile('C:/incoming/bad.tishka.json');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain('token');
    }
  });

  it('повреждённый файл не ломает list()', async () => {
    files.set(join(skillsDir, 'good.tishka.json'), JSON.stringify(baseSkill({ id: 'good' })));
    files.set(join(skillsDir, 'broken.tishka.json'), '{ это не json');

    const store = createSkillStore(skillsDir);
    const list = await store.list();

    expect(list.map((skill) => skill.id)).toEqual(['good']);
  });

  it('удаляет навык', async () => {
    const store = createSkillStore(skillsDir);
    const result = validateSkill(parsePreset());
    if (!result.ok) {
      throw new Error('пресет невалиден');
    }
    await store.save(result.skill);

    await store.remove('friday-morning');

    await expect(store.get('friday-morning')).resolves.toBeUndefined();
  });

  it('экспортирует навык в указанный файл', async () => {
    const store = createSkillStore(skillsDir);
    const result = validateSkill(parsePreset());
    if (!result.ok) {
      throw new Error('пресет невалиден');
    }
    await store.save(result.skill);

    const target = 'C:/out/friday-morning.tishka.json';
    await store.exportFile('friday-morning', target);

    expect(files.has(target)).toBe(true);
  });

  it('loadPresets копирует только новые и считает добавленные', async () => {
    files.set(join(presetsDir, 'friday-morning.tishka.json'), JSON.stringify(parsePreset()));
    const store = createSkillStore(skillsDir);

    await expect(store.loadPresets(presetsDir)).resolves.toBe(1);
    expect(files.has(join(skillsDir, 'friday-morning.tishka.json'))).toBe(true);
    await expect(store.loadPresets(presetsDir)).resolves.toBe(0);
  });
});
