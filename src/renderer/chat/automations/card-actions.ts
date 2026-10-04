import type { SkillOverview } from '../../../core/skills/overview';
import { button, clear, el, textInput } from '../../settings/dom';
import type { MyTabDeps } from './deps';
import { openSkillForm } from './skill-form';

function inputForm(entry: SkillOverview, host: HTMLElement): Promise<Record<string, unknown> | undefined> {
  clear(host);
  return new Promise((resolve) => {
    const box = el('div', 'skill-inputs');
    const controls: HTMLInputElement[] = [];
    for (const input of entry.skill.inputs ?? []) {
      const control = textInput(input.default === undefined ? '' : String(input.default));
      controls.push(control);
      box.append(el('span', 'skill-input-label', input.name), control);
    }
    const go = button('Выполнить');
    const cancel = button('Отмена', 'button button-secondary');
    go.addEventListener('click', () => {
      const result: Record<string, unknown> = {};
      (entry.skill.inputs ?? []).forEach((input, index) => {
        result[input.name] = controls[index].value;
      });
      resolve(result);
    });
    cancel.addEventListener('click', () => {
      resolve(undefined);
    });
    box.append(go, cancel);
    host.append(box);
  });
}

export function createActions(
  entry: SkillOverview,
  deps: MyTabDeps,
  message: HTMLElement,
  reload: () => void
): HTMLElement {
  const actions = el('div', 'skill-actions');
  const run = button('Запустить сейчас');
  const toggle = el('label', 'skill-toggle');
  const checkbox = el('input');
  checkbox.type = 'checkbox';
  checkbox.checked = entry.skill.enabled !== false;
  toggle.append(checkbox, document.createTextNode(' Включён'));
  const edit = button('Изменить', 'button button-secondary');
  const exportButton = button('Экспорт', 'button button-secondary');
  const remove = button('Удалить', 'button button-danger');
  const host = el('div', 'skill-extra');
  actions.append(run, toggle, edit, exportButton, remove, host);

  function show(text: string, error = false): void {
    clear(message);
    message.append(el('div', error ? 'message-error' : 'message-ok', text));
  }

  async function doRun(): Promise<void> {
    let inputs: Record<string, unknown> | undefined;
    if ((entry.skill.inputs ?? []).length > 0) {
      inputs = await inputForm(entry, host);
      if (inputs === undefined) {
        clear(host);
        return;
      }
    }
    try {
      const reply = await deps.api.run(entry.skill.id, inputs);
      show(reply.say);
    } catch (error) {
      show(error instanceof Error ? error.message : String(error), true);
    }
    clear(host);
    reload();
  }

  run.addEventListener('click', () => {
    void doRun();
  });

  checkbox.addEventListener('change', () => {
    void (async () => {
      const result = await deps.api.save({ ...entry.skill, enabled: checkbox.checked });
      if (!result.ok) {
        show(result.errors.join('; '), true);
        checkbox.checked = entry.skill.enabled !== false;
        return;
      }
      deps.onChanged();
    })();
  });

  edit.addEventListener('click', () => {
    openSkillForm({
      host,
      skill: entry.skill,
      onSave: (next) => deps.api.save(next),
      onCancel: () => {
        clear(host);
      }
    });
  });

  exportButton.addEventListener('click', () => {
    void (async () => {
      const result = await deps.api.exportFile(entry.skill.id);
      if (result.ok) {
        show('Файл сохранён');
      } else if (result.canceled !== true) {
        show(result.error ?? 'Не удалось сохранить', true);
      }
    })();
  });

  remove.addEventListener('click', () => {
    if (!deps.confirm(`Удалить навык «${entry.skill.name}»?`)) {
      return;
    }
    void (async () => {
      await deps.api.remove(entry.skill.id);
      deps.onChanged();
    })();
  });

  return actions;
}
