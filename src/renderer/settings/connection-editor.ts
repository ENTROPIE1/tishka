import type { ConnectionDraft, ConnectionTemplate } from '../../core/connections';
import type { ConnectionView } from '../../main/ipc-settings';
import { TEMPLATES, suggestName } from './connection-templates';
import { button, clear, el, field, runWithFeedback, textarea, textInput } from './dom';

export { TEMPLATE_OPTIONS, templateLabel } from './connection-templates';

const SAVE_LABELS = { busy: 'Сохраняю…', done: 'Готово', error: 'Ошибка' };
const CHECK_LABELS = { busy: 'Проверяю…', done: 'Готово', error: 'Ошибка' };

export interface EditorOptions {
  host: HTMLElement;
  template: ConnectionTemplate;
  previousName?: string;
  view?: ConnectionView;
  existingNames: string[];
  onDone(): void;
}

function parseEnv(text: string): Record<string, string> {
  const secrets: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') {
      continue;
    }
    const eq = trimmed.indexOf('=');
    const key = (eq >= 0 ? trimmed.slice(0, eq) : trimmed).trim();
    const value = eq >= 0 ? trimmed.slice(eq + 1) : '';
    if (key !== '') {
      secrets[key] = value;
    }
  }
  return secrets;
}

export function openEditor(options: EditorOptions): void {
  const spec = TEMPLATES[options.template];
  const box = el('div', 'editor');
  clear(options.host);

  if (spec.description !== undefined) {
    box.append(el('div', 'template-description', spec.description));
  }

  const name = textInput(options.view?.name ?? suggestName(options.template, options.existingNames));
  box.append(field('Имя', name));

  const inputs: Record<string, HTMLInputElement> = {};
  for (const item of spec.fields) {
    const input = textInput(options.view?.fields[item.key] ?? '');
    if (item.placeholder !== undefined) {
      input.placeholder = item.placeholder;
    }
    inputs[item.key] = input;
    box.append(field(item.label, input, item.hint));
  }

  const secretInputs: Record<string, HTMLInputElement> = {};
  for (const item of spec.secrets) {
    const isSet = options.view?.secrets.some((entry) => entry.field === item.key && entry.set) ?? false;
    const input = textInput('', 'password');
    input.placeholder = isSet ? 'задан (пусто — не менять)' : 'не задан';
    secretInputs[item.key] = input;
    box.append(field(item.label, input, item.hint));
  }

  let envArea: HTMLTextAreaElement | undefined;
  if (spec.freeEnv) {
    const preset = (options.view?.secrets ?? []).map((entry) => `${entry.field}=`).join('\n');
    envArea = textarea(preset, 'КЛЮЧ=значение, по строке; пустое значение сохраняет прежний секрет');
    box.append(field('Переменные окружения (секреты)', envArea));
  }

  const messages = el('div', 'messages');
  const check = button('Проверить', 'button button-secondary');
  const save = button('Сохранить');
  const cancel = button('Отмена', 'button button-secondary');
  check.hidden = options.previousName !== undefined;
  const actions = el('div', 'row');
  actions.append(check, save, cancel);
  box.append(actions, messages);

  function build(): ConnectionDraft {
    const fields: Record<string, string> = {};
    for (const [key, input] of Object.entries(inputs)) {
      fields[key] = input.value;
    }
    const secrets: Record<string, string> = {};
    for (const [key, input] of Object.entries(secretInputs)) {
      if (input.value.length > 0) {
        secrets[key] = input.value;
      }
    }
    if (envArea !== undefined) {
      Object.assign(secrets, parseEnv(envArea.value));
    }
    return { template: options.template, name: name.value.trim(), fields, secrets };
  }

  function showErrors(errors: string[], ok?: string): void {
    clear(messages);
    for (const error of errors) {
      messages.append(el('div', 'message-error', error));
    }
    if (ok !== undefined) {
      messages.append(el('div', 'message-ok', ok));
    }
  }

  check.addEventListener('click', () => {
    void runWithFeedback(check, CHECK_LABELS, async () => {
      const result = await window.tishka.connections.plan(build());
      if (!result.ok) {
        showErrors(result.errors);
        throw new Error('Проверка не прошла');
      }
      showErrors([], 'Проверка прошла');
    });
  });

  save.addEventListener('click', () => {
    void runWithFeedback(save, SAVE_LABELS, async () => {
      const result = await window.tishka.connections.save(build(), options.previousName);
      if (!result.ok) {
        showErrors(result.errors);
        throw new Error('Не удалось сохранить');
      }
    }).then((ok) => {
      if (ok) {
        options.onDone();
      }
    });
  });

  cancel.addEventListener('click', () => {
    clear(options.host);
  });

  options.host.append(box);
}
