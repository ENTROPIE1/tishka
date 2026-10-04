// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeSkill } from '../src/core/skills/describe';
import type { SkillOverview } from '../src/core/skills/overview';
import { validateSkill } from '../src/core/skills/validate';
import type { Skill } from '../src/core/types';
import { renderMyTab, type MyTabDeps } from '../src/renderer/chat/automations/my-tab';
import { mountAutomationsScreen } from '../src/renderer/chat/automations/screen';

function makeSkill(raw: Record<string, unknown>): Skill {
  const result = validateSkill({
    format: 'tishka-skill/1',
    phrases: ['утро'],
    trigger: { type: 'manual' },
    steps: [{ id: 'say', say: 'Готово' }],
    ...raw
  });
  if (!result.ok) {
    throw new Error(result.errors.join('; '));
  }
  return result.skill;
}

function overview(skill: Skill): SkillOverview {
  return { skill, description: describeSkill(skill), state: { runCount: 0 } };
}

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('renderMyTab: карточки навыков', () => {
  it('переключатель «Включён» сохраняет навык с enabled false', async () => {
    const skill = makeSkill({ id: 'morning', name: 'Утро', description: 'Приветствие' });
    const save = vi.fn(async (_skill: Skill) => ({ ok: true as const }));
    const deps: MyTabDeps = {
      api: { save, remove: vi.fn(), run: vi.fn(), exportFile: vi.fn(), importFile: vi.fn() },
      confirm: () => true,
      onChanged: vi.fn()
    };
    const host = document.createElement('div');
    renderMyTab(host, [overview(skill)], [], deps);

    const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(checkbox?.checked).toBe(true);
    checkbox!.checked = false;
    checkbox!.dispatchEvent(new Event('change'));
    await flush();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toMatchObject({ id: 'morning', enabled: false });
  });

  it('удаление спрашивает подтверждение и удаляет только после согласия', async () => {
    const skill = makeSkill({ id: 'morning', name: 'Утро', description: 'Приветствие' });
    const remove = vi.fn(async () => true);
    const confirm = vi.fn(() => false);
    const deps: MyTabDeps = {
      api: { save: vi.fn(), remove, run: vi.fn(), exportFile: vi.fn(), importFile: vi.fn() },
      confirm,
      onChanged: vi.fn()
    };
    const host = document.createElement('div');
    renderMyTab(host, [overview(skill)], [], deps);

    const removeButton = [...host.querySelectorAll('button')].find((item) => item.textContent === 'Удалить');
    removeButton!.click();
    expect(confirm).toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    removeButton!.click();
    await flush();
    expect(remove).toHaveBeenCalledWith('morning');
  });

  it('карточка само-навыка показывает состояние и следующую проверку', () => {
    const skill = makeSkill({
      id: 'watch',
      name: 'Слежу',
      description: 'Проверяю страницу',
      trigger: { type: 'watch', tool: 'open_urls', args: {}, everyMinutes: 5 }
    });
    const entry = overview(skill);
    entry.state = { runCount: 2, lastCheckAt: '2026-10-05T09:00:00.000Z', nextAt: '2026-10-05T09:05:00.000Z' };
    const deps: MyTabDeps = {
      api: { save: vi.fn(), remove: vi.fn(), run: vi.fn(), exportFile: vi.fn(), importFile: vi.fn() },
      confirm: () => true,
      onChanged: vi.fn()
    };
    const host = document.createElement('div');
    renderMyTab(host, [entry], [], deps);

    expect(host.textContent).toContain('работает');
    expect(host.textContent).toContain('следующая');
    expect(host.textContent).toContain('Работают сами');
  });
});

describe('renderMyTab: форма «Изменить»', () => {
  it('сохраняет фразы и период наблюдения', async () => {
    const skill = makeSkill({
      id: 'watch',
      name: 'Слежу',
      description: 'Проверяю',
      phrases: ['следи'],
      trigger: { type: 'watch', tool: 'open_urls', args: {}, everyMinutes: 5 }
    });
    const save = vi.fn(async (_skill: Skill) => ({ ok: true as const }));
    const deps: MyTabDeps = {
      api: { save, remove: vi.fn(), run: vi.fn(), exportFile: vi.fn(), importFile: vi.fn() },
      confirm: () => true,
      onChanged: vi.fn()
    };
    const host = document.createElement('div');
    renderMyTab(host, [overview(skill)], [], deps);

    [...host.querySelectorAll('button')].find((item) => item.textContent === 'Изменить')!.click();
    const every = host.querySelector<HTMLInputElement>('input[type="number"]');
    every!.value = '15';
    [...host.querySelectorAll('button')].find((item) => item.textContent === 'Сохранить')!.click();
    await flush();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toMatchObject({
      id: 'watch',
      trigger: { type: 'watch', everyMinutes: 15 }
    });
  });

  it('показывает ошибки проверки навыка', async () => {
    const skill = makeSkill({ id: 'morning', name: 'Утро', description: 'Приветствие' });
    const save = vi.fn(async (_skill: Skill) => ({ ok: false as const, errors: ['Название не должно быть пустым'] }));
    const deps: MyTabDeps = {
      api: { save, remove: vi.fn(), run: vi.fn(), exportFile: vi.fn(), importFile: vi.fn() },
      confirm: () => true,
      onChanged: vi.fn()
    };
    const host = document.createElement('div');
    renderMyTab(host, [overview(skill)], [], deps);

    [...host.querySelectorAll('button')].find((item) => item.textContent === 'Изменить')!.click();
    [...host.querySelectorAll('button')].find((item) => item.textContent === 'Сохранить')!.click();
    await flush();

    expect(host.textContent).toContain('Название не должно быть пустым');
  });
});

describe('mountAutomationsScreen', () => {
  it('переключает вкладки и показывает пресеты', async () => {
    const skill = makeSkill({ id: 'morning', name: 'Утро', description: 'Приветствие' });
    const api = {
      overview: vi.fn(async () => [overview(skill)]),
      presets: vi.fn(async () => [
        { id: 'preset', name: 'Готовый', description: 'Дело', requires: [], installed: false, valid: true, errors: [] }
      ]),
      save: vi.fn(),
      remove: vi.fn(),
      run: vi.fn(),
      exportFile: vi.fn(),
      importFile: vi.fn(),
      setEnabled: vi.fn(),
      installPreset: vi.fn()
    };
    (window as unknown as { tishka: unknown }).tishka = {
      automations: api,
      connections: { status: vi.fn(async () => []) },
      onEvent: () => () => undefined
    };

    const root = document.createElement('div');
    mountAutomationsScreen(root);
    await flush();

    expect(root.textContent).toContain('Утро');
    const presetsTab = [...root.querySelectorAll('button')].find((item) => item.textContent === 'Готовые');
    presetsTab!.click();
    await flush();

    expect(root.textContent).toContain('Готовый');
  });
});
