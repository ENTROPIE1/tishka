import type { InstallPresetResult, SaveSkillResult } from '../../../core/app';
import { describeSkill, type SkillDescription } from '../../../core/skills/describe';
import type { PresetInfo } from '../../../core/skills/presets';
import type { ConnectionView } from '../../../main/ipc-settings';
import type { ImportSkillResult } from '../../../main/ipc-automations';
import type { Skill } from '../../../core/types';
import { button, clear, el, sectionTitle } from '../../settings/dom';
import { kindIcon, kindTitle } from './format';

export interface PresetsApi {
  installPreset(id: string, overwrite?: boolean): Promise<InstallPresetResult>;
  importFile(): Promise<ImportSkillResult>;
  save(skill: Skill): Promise<SaveSkillResult>;
}

export interface PresetsTabDeps {
  api: PresetsApi;
  connections: ConnectionView[];
  onChanged(): void;
}

const CONNECTED = new Set(['connected']);

function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function needsRow(requires: string[], connections: ConnectionView[]): HTMLElement {
  const row = el('div', 'skill-needs');
  if (requires.length === 0) {
    row.append(el('span', 'need need-none', 'ничего не нужно'));
    return row;
  }
  for (const name of requires) {
    const view = connections.find((item) => sameName(item.name, name));
    const connected = view !== undefined && CONNECTED.has(view.state);
    row.append(el('span', `need ${connected ? 'need-ok' : 'need-missing'}`, name));
  }
  return row;
}

function addDescription(box: HTMLElement, description: SkillDescription): void {
  if (description.when !== '') {
    box.append(el('div', 'skill-when', description.when));
  }
  if (description.does.length > 0) {
    const list = el('ul', 'skill-does');
    for (const line of description.does) {
      list.append(el('li', undefined, line));
    }
    box.append(list);
  }
}

function card(info: PresetInfo, deps: PresetsTabDeps, error: HTMLElement): HTMLElement {
  const box = el('div', 'skill-card preset-card');
  const head = el('div', 'skill-card-head');
  const kind = info.skill?.trigger.type ?? 'manual';
  const icon = el('span', 'skill-kind', kindIcon(kind === 'manual' ? 'phrase' : kind));
  icon.title = kindTitle(kind === 'manual' ? 'phrase' : kind);
  const titles = el('div', 'skill-titles');
  titles.append(
    el('div', 'skill-name', info.name === '' ? info.id : info.name),
    el('div', 'skill-summary', info.description)
  );
  head.append(
    icon,
    titles,
    el('span', `skill-state ${info.installed ? 'state-active' : 'state-available'}`, info.installed ? 'установлен' : 'доступен')
  );
  box.append(head);
  if (info.skill !== undefined) {
    addDescription(box, describeSkill(info.skill));
  }
  box.append(needsRow(info.requires, deps.connections));

  if (!info.valid) {
    box.append(el('div', 'message-error', info.errors.join('; ') || 'Пресет повреждён'));
    return box;
  }

  const actions = el('div', 'skill-actions');
  if (info.installed) {
    actions.append(el('span', 'skill-installed', 'Установлен'));
  }
  const install = button(info.installed ? 'Поставить заново' : 'Поставить');
  install.addEventListener('click', () => {
    clear(error);
    void (async () => {
      const result = await deps.api.installPreset(info.id, info.installed);
      if (result.ok) {
        deps.onChanged();
        return;
      }
      error.append(el('div', 'message-error', result.error));
    })();
  });
  actions.append(install);
  box.append(actions);
  return box;
}

function preview(skill: Skill, deps: PresetsTabDeps, host: HTMLElement): void {
  clear(host);
  const box = el('div', 'skill-card preset-preview');
  box.append(el('div', 'skill-name', skill.name), el('div', 'skill-summary', skill.description));
  addDescription(box, describeSkill(skill));
  box.append(needsRow(skill.requires ?? [], deps.connections));

  const actions = el('div', 'skill-actions');
  const confirm = button('Поставить');
  const cancel = button('Отмена', 'button button-secondary');
  actions.append(confirm, cancel);
  box.append(actions);
  host.append(box);

  cancel.addEventListener('click', () => {
    clear(host);
  });
  confirm.addEventListener('click', () => {
    host.replaceChildren(el('div', 'message-ok', 'Навык импортирован — смотри во вкладке «Мои»'));
    void (async () => {
      const saved = await deps.api.save(skill);
      if (!saved.ok) {
        host.append(el('div', 'message-error', saved.errors.join('; ')));
        return;
      }
      deps.onChanged();
    })();
  });
}

export function renderPresetsTab(container: HTMLElement, presets: PresetInfo[], deps: PresetsTabDeps): void {
  clear(container);
  const top = el('div', 'presets-top');
  const importButton = button('Импорт из файла…', 'button button-secondary');
  top.append(importButton);
  const importMessage = el('div', 'presets-message');
  container.append(top, importMessage);

  importButton.addEventListener('click', () => {
    clear(importMessage);
    void (async () => {
      const result = await deps.api.importFile();
      if (result.canceled === true) {
        return;
      }
      if (!result.ok || result.skill === undefined) {
        importMessage.append(el('div', 'message-error', (result.errors ?? []).join('; ') || 'Не удалось импортировать'));
        return;
      }
      preview(result.skill, deps, importMessage);
    })();
  });

  const valid = presets.filter((preset) => preset.valid);
  if (valid.length === 0) {
    container.append(el('div', 'empty', 'Готовых навыков нет'));
    return;
  }
  container.append(sectionTitle('Готовые'));
  const list = el('div', 'skill-group');
  for (const info of valid) {
    list.append(card(info, deps, importMessage));
  }
  container.append(list);
}
