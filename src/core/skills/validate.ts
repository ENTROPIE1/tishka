import type { Panel, Skill, SkillInput, Step, Trigger } from '../types';

export type ValidationResult = { ok: true; skill: Skill } | { ok: false; errors: string[] };

const ID_PATTERN = /^[A-Za-z0-9-]+$/;
const MAX_ID_LENGTH = 64;
const SECRET_FIELD_PATTERN = /^(password|token|apikey|authorization)$/i;
const SUBSTITUTION_PATTERN = /\{\{([^}]*)\}\}/g;

interface Substitution {
  kind: 'steps' | 'inputs';
  name: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function scanSecrets(value: unknown, errors: string[]): void {
  if (typeof value === 'string') {
    if (value.includes('${secret:')) {
      errors.push('В навыке не должно быть ссылок на секреты (${secret:...})');
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      scanSecrets(item, errors);
    }
    return;
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_FIELD_PATTERN.test(key)) {
        errors.push(`В навыке не должно быть поля, похожего на секрет: ${key}`);
      }
      scanSecrets(item, errors);
    }
  }
}

function findSubstitutions(text: string): Substitution[] {
  const found: Substitution[] = [];
  for (const match of text.matchAll(SUBSTITUTION_PATTERN)) {
    const parts = match[1].trim().split('.');
    const kind = parts[0];
    const name = parts[1];
    if (name === undefined || name === '') {
      continue;
    }
    if (kind === 'steps' || kind === 'inputs') {
      found.push({ kind, name });
    }
  }
  return found;
}

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, out);
    }
    return;
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) {
      collectStrings(item, out);
    }
  }
}

function parseTrigger(value: unknown, errors: string[], knownTools: string[] | undefined): Trigger | undefined {
  if (!isRecord(value)) {
    errors.push('Поле trigger должно быть объектом');
    return undefined;
  }

  if (value.type === 'manual') {
    return { type: 'manual' };
  }

  if (value.type === 'schedule') {
    const hasAt = value.at !== undefined;
    const hasCron = value.cron !== undefined;
    if (hasAt === hasCron) {
      errors.push('У расписания должно быть задано ровно одно из полей at и cron');
      return undefined;
    }
    if (hasAt) {
      if (typeof value.at !== 'string') {
        errors.push('Поле at должно быть строкой с датой в формате ISO');
        return undefined;
      }
      if (Number.isNaN(Date.parse(value.at))) {
        errors.push('Поле at должно быть датой и временем в формате ISO, например 2026-10-05T09:00');
        return undefined;
      }
      return { type: 'schedule', at: value.at };
    }
    if (typeof value.cron !== 'string') {
      errors.push('Поле cron должно быть строкой');
      return undefined;
    }
    return { type: 'schedule', cron: value.cron };
  }

  if (value.type === 'watch') {
    if (typeof value.tool !== 'string' || value.tool === '') {
      errors.push('В наблюдении поле tool должно быть непустой строкой');
      return undefined;
    }
    if (knownTools !== undefined && !knownTools.includes(value.tool)) {
      errors.push(`Инструмент не найден: ${value.tool}`);
    }
    if (typeof value.everyMinutes !== 'number' || !(value.everyMinutes >= 1)) {
      errors.push('Поле everyMinutes должно быть числом не меньше 1');
      return undefined;
    }
    const trigger: Trigger = {
      type: 'watch',
      tool: value.tool,
      args: isRecord(value.args) ? value.args : {},
      everyMinutes: value.everyMinutes
    };
    if (typeof value.field === 'string') {
      trigger.field = value.field;
    }
    return trigger;
  }

  errors.push('Поле trigger должно быть одного из видов: manual, schedule, watch');
  return undefined;
}

function parseStep(
  rawStep: unknown,
  earlierStepIds: string[],
  inputNames: Set<string>,
  errors: string[],
  knownTools: string[] | undefined
): Step | undefined {
  if (!isRecord(rawStep)) {
    errors.push('Каждый шаг должен быть объектом');
    return undefined;
  }

  const kinds = (['tool', 'ask', 'say'] as const).filter((kind) => rawStep[kind] !== undefined);
  if (kinds.length !== 1) {
    errors.push('Каждый шаг должен быть ровно одного вида: tool, ask или say');
    return undefined;
  }

  const kind = kinds[0];
  let step: Step;
  const strings: string[] = [];

  if (kind === 'tool') {
    if (typeof rawStep.tool !== 'string' || rawStep.tool === '') {
      errors.push('В шаге tool поле tool должно быть непустой строкой');
      return undefined;
    }
    if (knownTools !== undefined && !knownTools.includes(rawStep.tool)) {
      errors.push(`Инструмент не найден: ${rawStep.tool}`);
    }
    step = { id: '', tool: rawStep.tool, args: isRecord(rawStep.args) ? rawStep.args : {} };
    collectStrings(rawStep.args, strings);
  } else if (kind === 'ask') {
    if (typeof rawStep.ask !== 'string') {
      errors.push('В шаге ask поле ask должно быть строкой');
      return undefined;
    }
    step = { id: '', ask: rawStep.ask };
    strings.push(rawStep.ask);
  } else {
    if (typeof rawStep.say !== 'string') {
      errors.push('В шаге say поле say должно быть строкой');
      return undefined;
    }
    step =
      rawStep.show === undefined
        ? { id: '', say: rawStep.say }
        : { id: '', say: rawStep.say, show: rawStep.show as Panel };
    strings.push(rawStep.say);
  }

  for (const text of strings) {
    for (const substitution of findSubstitutions(text)) {
      if (substitution.kind === 'steps' && !earlierStepIds.includes(substitution.name)) {
        errors.push(`Подстановка ссылается на неизвестный шаг: {{steps.${substitution.name}}}`);
      }
      if (substitution.kind === 'inputs' && !inputNames.has(substitution.name)) {
        errors.push(`Подстановка ссылается на неизвестный вход: {{inputs.${substitution.name}}}`);
      }
    }
  }

  return step;
}

export function validateSkill(input: unknown, knownTools?: string[]): ValidationResult {
  const errors: string[] = [];
  scanSecrets(input, errors);

  if (!isRecord(input)) {
    errors.push('Навык должен быть объектом');
    return { ok: false, errors };
  }

  if (input.format !== 'tishka-skill/1') {
    errors.push('Поле format должно быть равно "tishka-skill/1"');
  }

  const id = typeof input.id === 'string' ? input.id : '';
  if (typeof input.id !== 'string' || !ID_PATTERN.test(id) || id.length > MAX_ID_LENGTH) {
    errors.push('Поле id должно состоять из латиницы, цифр и дефиса, длина от 1 до 64');
  }

  const name = typeof input.name === 'string' ? input.name : '';
  if (name.trim() === '') {
    errors.push('Поле name не должно быть пустым');
  }

  let phrases: string[] = [];
  if (!isStringArray(input.phrases)) {
    errors.push('Поле phrases должно быть массивом строк');
  } else {
    phrases = input.phrases;
  }

  const inputs: SkillInput[] = [];
  const inputNames = new Set<string>();
  if (input.inputs !== undefined) {
    if (!Array.isArray(input.inputs)) {
      errors.push('Поле inputs должно быть массивом');
    } else {
      for (const rawInput of input.inputs) {
        if (!isRecord(rawInput) || typeof rawInput.name !== 'string' || rawInput.name === '') {
          errors.push('Каждый вход в inputs должен иметь непустое поле name');
          continue;
        }
        const parsedInput: SkillInput = {
          name: rawInput.name,
          description: typeof rawInput.description === 'string' ? rawInput.description : '',
          required: typeof rawInput.required === 'boolean' ? rawInput.required : false
        };
        if (rawInput.default !== undefined) {
          parsedInput.default = rawInput.default;
        }
        inputs.push(parsedInput);
        inputNames.add(parsedInput.name);
      }
    }
  }

  const trigger = parseTrigger(input.trigger, errors, knownTools);
  if (trigger !== undefined && trigger.type === 'manual' && isStringArray(input.phrases) && phrases.length === 0) {
    errors.push('Для ручного запуска нужна хотя бы одна фраза');
  }

  const steps: Step[] = [];
  const stepIds: string[] = [];
  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    errors.push('Поле steps должно быть непустым массивом');
  } else {
    for (const rawStep of input.steps) {
      const stepId = isRecord(rawStep) && typeof rawStep.id === 'string' ? rawStep.id : '';
      if (stepId === '') {
        errors.push('У каждого шага должно быть непустое поле id');
      } else if (stepIds.includes(stepId)) {
        errors.push(`Идентификатор шага повторяется: ${stepId}`);
      }

      const step = parseStep(rawStep, stepIds, inputNames, errors, knownTools);
      if (step !== undefined) {
        step.id = stepId;
        steps.push(step);
      }
      if (stepId !== '') {
        stepIds.push(stepId);
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const skill: Skill = {
    format: 'tishka-skill/1',
    id,
    name,
    description: typeof input.description === 'string' ? input.description : '',
    phrases,
    trigger: trigger as Trigger,
    steps
  };
  if (inputs.length > 0) {
    skill.inputs = inputs;
  }
  if (isStringArray(input.requires)) {
    skill.requires = input.requires;
  }
  if (typeof input.enabled === 'boolean') {
    skill.enabled = input.enabled;
  }

  return { ok: true, skill };
}
