import type { SaveSkillResult } from '../../../core/app';
import { describeSkill } from '../../../core/skills/describe';
import type { Skill, SkillInput, Trigger } from '../../../core/types';
import { button, clear, el, field, selectInput, textarea, textInput } from '../../settings/dom';

export interface SkillFormDeps {
  host: HTMLElement;
  skill: Skill;
  onSave(skill: Skill): Promise<SaveSkillResult>;
  onCancel(): void;
}

const DAY_OPTIONS = [
  { value: '*', label: 'каждый день' },
  { value: '1-5', label: 'по будням' },
  { value: '0,6', label: 'по выходным' }
];

function clockValue(cron: string | undefined): string {
  const fields = (cron ?? '').trim().split(/\s+/);
  if (fields.length !== 5 || !/^\d+$/.test(fields[0]) || !/^\d+$/.test(fields[1])) {
    return '09:00';
  }
  return `${fields[1].padStart(2, '0')}:${fields[0].padStart(2, '0')}`;
}

function dayValue(cron: string | undefined): string {
  const fields = (cron ?? '').trim().split(/\s+/);
  const dow = fields.length === 5 ? fields[4] : '*';
  return DAY_OPTIONS.some((option) => option.value === dow) ? dow : '*';
}

function phraseList(skill: Skill): string {
  return skill.phrases.join(', ');
}

function parsePhrases(text: string): string[] {
  return text
    .split(',')
    .map((phrase) => phrase.trim())
    .filter((phrase) => phrase !== '');
}

function triggerFields(trigger: Trigger): { fields: HTMLElement[]; build(values: FormValues): Trigger } {
  if (trigger.type === 'schedule') {
    const time = textInput(clockValue(trigger.cron), 'time');
    const day = selectInput(DAY_OPTIONS, dayValue(trigger.cron));
    return {
      fields: [field('Время', time), field('Дни', day)],
      build: (values) => {
        const [hours, minutes] = values.time.split(':');
        return { type: 'schedule', cron: `${Number(minutes)} ${Number(hours)} * * ${values.day}` };
      }
    };
  }
  if (trigger.type === 'watch') {
    const every = textInput(String(trigger.everyMinutes), 'number');
    return {
      fields: [field('Проверять каждые, минут', every, `Инструмент: ${trigger.tool}`)],
      build: (values) => ({ ...trigger, everyMinutes: Math.max(1, Number(values.every) || 1) })
    };
  }
  return { fields: [], build: () => ({ type: 'manual' }) };
}

interface FormValues {
  name: string;
  description: string;
  phrases: string;
  time: string;
  day: string;
  every: string;
  inputs: string[];
}

function readValues(controls: {
  name: HTMLInputElement;
  description: HTMLTextAreaElement;
  phrases: HTMLTextAreaElement;
  time: HTMLInputElement;
  day: HTMLSelectElement;
  every: HTMLInputElement;
  inputs: HTMLInputElement[];
}): FormValues {
  return {
    name: controls.name.value.trim(),
    description: controls.description.value.trim(),
    phrases: controls.phrases.value,
    time: controls.time.value,
    day: controls.day.value,
    every: controls.every.value,
    inputs: controls.inputs.map((input) => input.value)
  };
}

function withInputs(skill: Skill, values: string[]): SkillInput[] | undefined {
  if (skill.inputs === undefined) {
    return undefined;
  }
  return skill.inputs.map((input, index) => {
    const value = values[index] ?? '';
    return { ...input, default: value === '' ? input.default : value };
  });
}

export function openSkillForm(deps: SkillFormDeps): void {
  clear(deps.host);
  const form = el('div', 'skill-form editor');

  const name = textInput(deps.skill.name);
  const description = textarea(deps.skill.description);
  const phrases = textarea(phraseList(deps.skill));
  const { fields: trigFields, build } = triggerFields(deps.skill.trigger);
  const inputFields: HTMLInputElement[] = [];
  const inputsBlock = el('div', 'skill-form-inputs');
  for (const input of deps.skill.inputs ?? []) {
    const control = textInput(input.default === undefined ? '' : String(input.default));
    inputFields.push(control);
    inputsBlock.append(field(input.description === '' ? input.name : input.description, control));
  }

  const errors = el('div', 'skill-form-errors');
  const save = button('Сохранить');
  const cancel = button('Отмена', 'button button-secondary');
  const actions = el('div', 'row');
  actions.append(save, cancel);

  form.append(field('Название', name), field('Описание', description));
  if (deps.skill.trigger.type === 'manual') {
    form.append(field('Фразы через запятую', phrases));
  }
  form.append(...trigFields);
  if (inputFields.length > 0) {
    form.append(inputsBlock);
  }

  const steps = el('div', 'skill-form-steps');
  steps.append(el('div', 'field-label', 'Шаги'));
  const stepsList = el('ul', 'skill-does');
  for (const line of describeSkill(deps.skill).does) {
    stepsList.append(el('li', undefined, line));
  }
  steps.append(stepsList, el('div', 'field-hint', 'Чтобы изменить шаги, попросите Тишку: «измени навык …»'));
  form.append(steps);

  form.append(errors, actions);
  deps.host.append(form);

  cancel.addEventListener('click', () => {
    deps.onCancel();
  });

  save.addEventListener('click', () => {
    clear(errors);
    const values = readValues({
      name,
      description,
      phrases,
      time: form.querySelector<HTMLInputElement>('input[type="time"]') ?? textInput(),
      day: form.querySelector<HTMLSelectElement>('select') ?? selectInput([], ''),
      every: form.querySelector<HTMLInputElement>('input[type="number"]') ?? textInput(),
      inputs: inputFields
    });
    const next: Skill = {
      ...deps.skill,
      name: values.name,
      description: values.description,
      phrases: parsePhrases(values.phrases),
      trigger: build(values)
    };
    const inputs = withInputs(deps.skill, values.inputs);
    if (inputs !== undefined) {
      next.inputs = inputs;
    }
    void (async () => {
      const result = await deps.onSave(next);
      if (result.ok) {
        return;
      }
      for (const message of result.errors) {
        errors.append(el('div', 'message-error', message));
      }
    })();
  });
}
