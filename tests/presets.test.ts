import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEventBus } from '../src/core/events';
import { installPreset, listPresets, registerPresetTools } from '../src/core/skills/presets';
import { createSkillRunner } from '../src/core/skills/runner';
import { createSkillStore } from '../src/core/skills/store';
import { validateSkill } from '../src/core/skills/validate';
import { registerBuiltinTools } from '../src/core/tools/builtin';
import { createToolRegistry } from '../src/core/tools/registry';
import type { Skill, ToolDef, ToolHandler, ToolRegistry } from '../src/core/types';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const presetsDir = join(root, 'presets');
const NOW = new Date('2026-10-05T09:30:00');
const SUFFIX = '.tishka.json';

interface RawPreset {
  id: string;
  description: string;
  phrases: string[];
  trigger: { type: string };
  inputs?: { name: string; required: boolean; default?: unknown }[];
  requires?: string[];
  steps: { id: string; tool?: string; ask?: string; say?: string; args?: unknown; show?: unknown }[];
}

function presetNames(): string[] {
  return readdirSync(presetsDir).filter((name) => name.endsWith(SUFFIX)).sort();
}

function readPreset(name: string): RawPreset {
  return JSON.parse(readFileSync(join(presetsDir, name), 'utf8')) as RawPreset;
}

function validSkill(name: string): Skill {
  const result = validateSkill(readPreset(name));
  if (!result.ok) {
    throw new Error(`${name}: ${result.errors.join('; ')}`);
  }
  return result.skill;
}

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

function serverToolNames(server: string): string[] {
  const source = readFileSync(join(root, 'mcp-servers', server, 'src', 'server.ts'), 'utf8');
  return [...source.matchAll(/name: '([a-z][a-z_]+)'/g)].map((match) => match[1]);
}

function builtinNames(): Set<string> {
  const registry = createToolRegistry(createEventBus());
  registerBuiltinTools(registry, { openExternal: async () => undefined, showPanel: vi.fn(), now: () => NOW });
  return new Set(registry.list().map((tool) => tool.name));
}

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tishka-presets-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (dirs.length > 0) {
    await rm(dirs.pop() as string, { recursive: true, force: true });
  }
});

describe('файлы пресетов', () => {
  const files = presetNames();

  it('проходят проверку, id совпадает с именем и не повторяется', () => {
    const ids = files.map((name) => {
      const skill = validSkill(name);
      expect(skill.id).toBe(name.slice(0, -SUFFIX.length));
      return skill.id;
    });
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('friday-morning');
    expect(ids).toContain('watch-page');
  });

  it('шаги используют встроенные инструменты или инструменты из requires', () => {
    const builtin = builtinNames();
    const byServer: Record<string, string[]> = {
      confluence: serverToolNames('confluence').map((name) => `confluence__${name}`),
      exchange: serverToolNames('exchange').map((name) => `exchange__${name}`),
      jira: serverToolNames('jira').map((name) => `jira__${name}`)
    };
    for (const name of files) {
      const preset = readPreset(name);
      const allowed = new Set([...builtin, ...(preset.requires ?? []).flatMap((server) => byServer[server] ?? [])]);
      for (const step of preset.steps) {
        if (step.tool !== undefined) expect(allowed.has(step.tool), `${name}: ${step.tool}`).toBe(true);
      }
    }
    expect(byServer.confluence.length).toBeGreaterThan(0);
    expect(byServer.exchange.length).toBeGreaterThan(0);
    expect(byServer.jira.length).toBeGreaterThan(0);
  });

  it('подстановки ссылаются на входы и прошлые шаги, в say нет цифр и латиницы', () => {
    for (const name of files) {
      const preset = readPreset(name);
      const inputs = new Set((preset.inputs ?? []).map((input) => input.name));
      const earlier = new Set<string>();
      for (const step of preset.steps) {
        const fields = { args: step.args, ask: step.ask, say: step.say, show: step.show };
        for (const text of strings(fields)) {
          for (const match of text.matchAll(/\{\{([^}]*)\}\}/g)) {
            const [kind, ref] = match[1].trim().split('.');
            if (kind === 'inputs') expect(inputs.has(ref), `${name}: inputs.${ref}`).toBe(true);
            if (kind === 'steps') expect(earlier.has(ref), `${name}: steps.${ref}`).toBe(true);
          }
        }
        if (step.say !== undefined) expect(step.say, name).not.toMatch(/[0-9A-Za-z]/);
        earlier.add(step.id);
      }
    }
  });

  it('нет адресов, кроме example.org, и у ручных пресетов две-четыре фразы', () => {
    for (const name of files) {
      const text = readFileSync(join(presetsDir, name), 'utf8');
      for (const match of text.matchAll(/https?:\/\/[^\s"')\]}]+/g)) {
        expect(new URL(match[0]).hostname, name).toBe('example.org');
      }
      const preset = readPreset(name);
      expect(preset.description.length, name).toBeGreaterThan(0);
      if (preset.trigger.type === 'manual') {
        expect(preset.phrases.length, name).toBeGreaterThanOrEqual(2);
        expect(preset.phrases.length, name).toBeLessThanOrEqual(4);
      }
    }
  });
});

describe('listPresets и installPreset', () => {
  it('listPresets помечает установленные', async () => {
    const skill = validSkill('friday-morning.tishka.json');
    const store = { get: async (id: string): Promise<Skill | undefined> => (id === 'friday-morning' ? skill : undefined) };

    const infos = await listPresets(presetsDir, store);

    expect(infos.find((info) => info.id === 'friday-morning')?.installed).toBe(true);
    expect(infos.filter((info) => info.valid)).toHaveLength(presetNames().length);
  });

  it('ставит, не перезаписывает без overwrite и не ставит повреждённый', async () => {
    const store = createSkillStore(await tempDir());
    await expect(installPreset(presetsDir, 'friday-morning', store)).resolves.toEqual({ ok: true });
    await expect(installPreset(presetsDir, 'friday-morning', store)).resolves.toEqual({
      ok: false,
      error: 'Навык уже установлен'
    });
    await expect(installPreset(presetsDir, 'friday-morning', store, { overwrite: true })).resolves.toEqual({ ok: true });

    const dir = await tempDir();
    await writeFile(join(dir, 'broken.tishka.json'), '{ это не json', 'utf8');
    const broken = createSkillStore(await tempDir());
    await expect(installPreset(dir, 'broken', broken)).resolves.toMatchObject({ ok: false });
    await expect(broken.get('broken')).resolves.toBeUndefined();
  });
});

describe('инструменты пресетов и прогон', () => {
  it('presets_list и preset_install зарегистрированы как встроенные', async () => {
    const registry = createToolRegistry(createEventBus());
    registerPresetTools(registry, { presetsDir, store: createSkillStore(await tempDir()), events: createEventBus() });

    const defs = registry.list();
    expect(defs.map((tool) => tool.name)).toEqual(expect.arrayContaining(['presets_list', 'preset_install']));
    expect(defs.every((tool) => tool.source === 'builtin')).toBe(true);
  });

  it('каждый пресет доходит до конца и отдаёт реплику', async () => {
    const runner = createSkillRunner({
      registry: stubRegistry(),
      ask: async () => 'Подставной ответ',
      events: createEventBus(),
      now: () => NOW
    });

    for (const name of presetNames()) {
      const skill = validSkill(name);
      const inputs: Record<string, unknown> = {};
      for (const input of skill.inputs ?? []) inputs[input.name] = input.default ?? 'значение';
      const result = await runner.run(skill, inputs);
      expect(result.ok, `${name}: ${result.error ?? ''}`).toBe(true);
      expect(result.reply?.say ?? '').not.toBe('');
    }
  });
});

function stubRegistry(): ToolRegistry {
  const def = (name: string): ToolDef => ({
    name,
    description: name,
    inputSchema: { type: 'object' },
    source: 'builtin',
    readOnly: true
  });
  const handlers: Record<string, ToolHandler> = {
    open_urls: async () => ({ ok: true, content: 'открыл' }),
    exchange__list_meetings: async () => ({ ok: true, content: '{}', data: { meetings: [] } }),
    exchange__mail_search: async () => ({ ok: true, content: '{}', data: { mails: [] } }),
    exchange__mail_draft_link: async () => ({ ok: true, content: '{}', data: { url: 'https://example.org/mail', hint: '' } }),
    exchange__meeting_draft_link: async () => ({ ok: true, content: '{}', data: { url: 'https://example.org/meet' } }),
    jira__jira_my_issues: async () => ({ ok: true, content: '{}', data: { total: 0, groups: [] } }),
    confluence__get_page_version: async () => ({ ok: true, content: '{}', data: { version: '5', url: 'https://example.org/page' } }),
    confluence__get_page_history: async () => ({ ok: true, content: '{}', data: { versions: [] } })
  };
  const registry = createToolRegistry(createEventBus());
  for (const [name, handler] of Object.entries(handlers)) registry.register(def(name), handler);
  return registry;
}
