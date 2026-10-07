import { normalizeBaseUrl, type GatewayCheckResult } from '../../core/llm/check';
import type { Config } from '../../core/types';
import {
  button,
  clear,
  el,
  field,
  runWithFeedback,
  sectionTitle,
  selectInput,
  textInput,
  type SettingsSection
} from './dom';

const SAVE_LABELS = { busy: 'Сохраняю…', done: 'Готово', error: 'Ошибка' };
const CHECK_LABELS = { busy: 'Проверяю…', done: 'Готово', error: 'Ошибка' };
const API_KEY_SECRET = 'DKS_API_KEY';
const KEY_SET = 'Ключ задан';
const KEY_MISSING = 'Ключ не задан';
const MODEL_MISSING = 'такой модели в списке шлюза нет';
const FALLBACK_HINT = 'если основная не отвечает';
const MODEL_LIST_ID = 'gateway-model-list';
const VISION_LIST_ID = 'gateway-vision-list';
const FORMAT_OPTIONS = [
  { value: 'chat', label: 'Chat Completions' },
  { value: 'responses', label: 'Responses' }
];

export function mountModelSection(root: HTMLElement): SettingsSection {
  clear(root);
  root.append(sectionTitle('Модель'));

  const baseUrl = textInput();
  const format = selectInput(FORMAT_OPTIONS, 'chat');
  const model = el('select', 'select-input');
  model.id = MODEL_LIST_ID;
  const fallbackModel = el('select', 'select-input');
  const visionModel = el('select', 'select-input');
  visionModel.id = VISION_LIST_ID;
  const visionFallbackModel = el('select', 'select-input');
  const key = textInput('', 'password');
  const keyState = el('span', 'field-hint', KEY_MISSING);
  const modelHint = el('span', 'field-hint model-warning');
  const fallbackHint = el('span', 'field-hint model-warning');
  const visionHint = el('span', 'field-hint model-warning');
  const visionFallbackHint = el('span', 'field-hint model-warning');
  modelHint.hidden = true;
  fallbackHint.hidden = true;
  visionHint.hidden = true;
  visionFallbackHint.hidden = true;

  const modelField = field('Модель', model);
  modelField.append(modelHint);
  const fallbackField = field('Запасная модель', fallbackModel, FALLBACK_HINT);
  fallbackField.append(fallbackHint);
  const visionField = field('Модель для картинок', visionModel);
  visionField.append(visionHint);
  const visionFallbackField = field('Запасная модель для картинок', visionFallbackModel, FALLBACK_HINT);
  visionFallbackField.append(visionFallbackHint);

  const save = button('Сохранить');
  const check = button('Проверить', 'button button-secondary');
  const messages = el('div', 'messages');

  root.append(
    field('Адрес шлюза', baseUrl),
    field('Формат запросов', format, 'Выберите Responses, если шлюз принимает только POST /responses'),
    modelField,
    fallbackField,
    visionField,
    visionFallbackField,
    field('Ключ шлюза', key, 'Сохранённый ключ не показывается; пустое поле оставляет прежний ключ'),
    field('Состояние ключа', keyState)
  );
  const actions = el('div', 'row');
  actions.append(save, check);
  root.append(actions, messages);

  function show(error: string | undefined, ok?: string): void {
    clear(messages);
    if (error !== undefined) {
      messages.append(el('div', 'message-error', error));
    }
    if (ok !== undefined) {
      messages.append(el('div', 'message-ok', ok));
    }
  }

  function fillSelect(select: HTMLSelectElement, names: string[], current: string, emptyLabel: string): void {
    const unique: string[] = [];
    const seen = new Set<string>();
    if (current !== '' && !names.includes(current)) {
      unique.push(current);
    }
    for (const name of names) {
      if (name !== '' && !seen.has(name)) {
        seen.add(name);
        unique.push(name);
      }
    }
    clear(select);
    if (current === '' || unique.length === 0) {
      const blank = el('option', undefined, emptyLabel);
      blank.value = '';
      select.append(blank);
    }
    for (const name of unique) {
      const option = el('option', undefined, name);
      option.value = name;
      select.append(option);
    }
    select.value = unique.includes(current) ? current : '';
  }

  function warnMissing(hint: HTMLElement, value: string, names: string[]): void {
    const trimmed = value.trim();
    if (names.length === 0 || trimmed === '' || names.includes(trimmed)) {
      hint.hidden = true;
      return;
    }
    hint.textContent = MODEL_MISSING;
    hint.hidden = false;
  }

  let knownModels: string[] = [];

  function applyModels(names: string[]): void {
    knownModels = names;
    fillSelect(model, names, model.value.trim(), 'выберите модель');
    fillSelect(fallbackModel, names, fallbackModel.value.trim(), 'не задана');
    fillSelect(visionModel, names, visionModel.value.trim(), 'выберите модель');
    fillSelect(visionFallbackModel, names, visionFallbackModel.value.trim(), 'не задана');
    warnMissing(modelHint, model.value, names);
    warnMissing(fallbackHint, fallbackModel.value, names);
    warnMissing(visionHint, visionModel.value, names);
    warnMissing(visionFallbackHint, visionFallbackModel.value, names);
  }

  async function loadModels(keySet: boolean): Promise<void> {
    if (!keySet && key.value.trim() === '') {
      return;
    }
    const result = await window.tishka.config.listModels({
      baseUrl: baseUrl.value,
      key: key.value.trim()
    });
    if (result.ok && result.models.length > 0) {
      applyModels(result.models);
    }
  }

  async function refresh(): Promise<void> {
    const view = await window.tishka.config.get();
    baseUrl.value = view.config.llm.baseUrl;
    format.value = view.config.llm.api;
    fillSelect(model, knownModels, view.config.llm.model, 'выберите модель');
    fillSelect(fallbackModel, knownModels, view.config.llm.fallbackModel, 'не задана');
    fillSelect(visionModel, knownModels, view.config.llm.visionModel, 'выберите модель');
    fillSelect(visionFallbackModel, knownModels, view.config.llm.visionFallbackModel, 'не задана');
    keyState.textContent = view.gatewayKeySet ? KEY_SET : KEY_MISSING;
    await loadModels(view.gatewayKeySet);
  }

  save.addEventListener('click', () => {
    void runWithFeedback(save, SAVE_LABELS, async () => {
      const normalized = normalizeBaseUrl(baseUrl.value);
      if (!normalized.ok) {
        show(normalized.error);
        throw new Error(normalized.error);
      }
      try {
        const view = await window.tishka.config.get();
        const next: Config = {
          ...view.config,
          llm: {
            baseUrl: normalized.value,
            model: model.value.trim(),
            fallbackModel: fallbackModel.value.trim(),
            visionModel: visionModel.value.trim(),
            visionFallbackModel: visionFallbackModel.value.trim(),
            api: format.value === 'responses' ? 'responses' : 'chat'
          }
        };
        await window.tishka.config.save(next);
        const trimmedKey = key.value.trim();
        if (trimmedKey !== '') {
          await window.tishka.secrets.set(API_KEY_SECRET, trimmedKey);
          key.value = '';
        }
        await refresh();
        show(undefined, 'Настройки модели сохранены');
      } catch (error) {
        show(error instanceof Error ? error.message : String(error));
        throw error;
      }
    });
  });

  // «Проверить» проверяет основную и запасную модели и показывает результат по каждой.
  check.addEventListener('click', () => {
    void runWithFeedback(check, CHECK_LABELS, async () => {
      const targets = [
        { value: model.value.trim(), fallback: false },
        { value: fallbackModel.value.trim(), fallback: true }
      ].filter((target) => target.value !== '');
      if (targets.length === 0) {
        show('Укажите модель');
        throw new Error('Укажите модель');
      }
      const results: { value: string; fallback: boolean; result: GatewayCheckResult }[] = [];
      for (const target of targets) {
        const result = await window.tishka.config.checkGateway({
          baseUrl: baseUrl.value,
          model: target.value,
          key: key.value.trim(),
          api: format.value
        });
        results.push({ ...target, result });
      }
      const ok = results.find((item) => item.result.ok);
      if (ok !== undefined) {
        applyModels(ok.result.models);
      }
      clear(messages);
      let firstError: string | undefined;
      for (const item of results) {
        if (item.result.ok) {
          const text = item.fallback
            ? `Запасная модель ${item.value} отвечает, ${item.result.ms} мс`
            : `Шлюз отвечает, модель ${item.value}, ${item.result.ms} мс`;
          messages.append(el('div', 'message-ok', text));
        } else {
          const error = item.result.error ?? 'Не удалось проверить шлюз';
          messages.append(el('div', 'message-error', item.fallback ? `Запасная модель: ${error}` : error));
          if (firstError === undefined) {
            firstError = error;
          }
        }
      }
      if (firstError !== undefined) {
        throw new Error(firstError);
      }
    });
  });

  model.addEventListener('change', () => {
    warnMissing(modelHint, model.value, knownModels);
  });

  fallbackModel.addEventListener('change', () => {
    warnMissing(fallbackHint, fallbackModel.value, knownModels);
  });

  visionModel.addEventListener('change', () => {
    warnMissing(visionHint, visionModel.value, knownModels);
  });

  visionFallbackModel.addEventListener('change', () => {
    warnMissing(visionFallbackHint, visionFallbackModel.value, knownModels);
  });

  void refresh();

  return { refresh: () => void refresh() };
}
