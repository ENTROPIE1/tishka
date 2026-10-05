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
  const model = textInput();
  const fallbackModel = textInput();
  const visionModel = textInput();
  const visionFallbackModel = textInput();
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

  const modelList = el('datalist');
  modelList.id = MODEL_LIST_ID;
  const visionList = el('datalist');
  visionList.id = VISION_LIST_ID;
  model.setAttribute('list', MODEL_LIST_ID);
  fallbackModel.setAttribute('list', MODEL_LIST_ID);
  visionModel.setAttribute('list', VISION_LIST_ID);
  visionFallbackModel.setAttribute('list', VISION_LIST_ID);

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
  root.append(actions, messages, modelList, visionList);

  function show(error: string | undefined, ok?: string): void {
    clear(messages);
    if (error !== undefined) {
      messages.append(el('div', 'message-error', error));
    }
    if (ok !== undefined) {
      messages.append(el('div', 'message-ok', ok));
    }
  }

  function fillList(list: HTMLDataListElement, names: string[]): void {
    clear(list);
    for (const name of names) {
      const option = el('option');
      option.value = name;
      list.append(option);
    }
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

  function applyModels(names: string[]): void {
    fillList(modelList, names);
    fillList(visionList, names);
    warnMissing(modelHint, model.value, names);
    warnMissing(fallbackHint, fallbackModel.value, names);
    warnMissing(visionHint, visionModel.value, names);
    warnMissing(visionFallbackHint, visionFallbackModel.value, names);
  }

  async function refresh(): Promise<void> {
    const view = await window.tishka.config.get();
    baseUrl.value = view.config.llm.baseUrl;
    format.value = view.config.llm.api;
    model.value = view.config.llm.model;
    fallbackModel.value = view.config.llm.fallbackModel;
    visionModel.value = view.config.llm.visionModel;
    visionFallbackModel.value = view.config.llm.visionFallbackModel;
    keyState.textContent = view.gatewayKeySet ? KEY_SET : KEY_MISSING;
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

  model.addEventListener('input', () => {
    warnMissing(modelHint, model.value, [...modelList.options].map((option) => option.value));
  });

  fallbackModel.addEventListener('input', () => {
    warnMissing(fallbackHint, fallbackModel.value, [...modelList.options].map((option) => option.value));
  });

  visionModel.addEventListener('input', () => {
    warnMissing(visionHint, visionModel.value, [...visionList.options].map((option) => option.value));
  });

  visionFallbackModel.addEventListener('input', () => {
    warnMissing(visionFallbackHint, visionFallbackModel.value, [...visionList.options].map((option) => option.value));
  });

  void refresh();

  return { refresh: () => void refresh() };
}
