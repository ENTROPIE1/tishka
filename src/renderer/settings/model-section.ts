import { normalizeBaseUrl } from '../../core/llm/check';
import type { Config } from '../../core/types';
import { button, clear, el, field, runWithFeedback, sectionTitle, textInput, type SettingsSection } from './dom';

const SAVE_LABELS = { busy: 'Сохраняю…', done: 'Готово', error: 'Ошибка' };
const CHECK_LABELS = { busy: 'Проверяю…', done: 'Готово', error: 'Ошибка' };
const API_KEY_SECRET = 'DKS_API_KEY';
const KEY_SET = 'Ключ задан';
const KEY_MISSING = 'Ключ не задан';
const MODEL_MISSING = 'такой модели в списке шлюза нет';
const MODEL_LIST_ID = 'gateway-model-list';
const VISION_LIST_ID = 'gateway-vision-list';

export function mountModelSection(root: HTMLElement): SettingsSection {
  clear(root);
  root.append(sectionTitle('Модель'));

  const baseUrl = textInput();
  const model = textInput();
  const visionModel = textInput();
  const key = textInput('', 'password');
  const keyState = el('span', 'field-hint', KEY_MISSING);
  const modelHint = el('span', 'field-hint model-warning');
  const visionHint = el('span', 'field-hint model-warning');
  modelHint.hidden = true;
  visionHint.hidden = true;

  const modelList = el('datalist');
  modelList.id = MODEL_LIST_ID;
  const visionList = el('datalist');
  visionList.id = VISION_LIST_ID;
  model.setAttribute('list', MODEL_LIST_ID);
  visionModel.setAttribute('list', VISION_LIST_ID);

  const modelField = field('Модель', model);
  modelField.append(modelHint);
  const visionField = field('Модель для картинок', visionModel);
  visionField.append(visionHint);

  const save = button('Сохранить');
  const check = button('Проверить', 'button-secondary');
  const messages = el('div', 'messages');

  root.append(
    field('Адрес шлюза', baseUrl),
    modelField,
    visionField,
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
    warnMissing(visionHint, visionModel.value, names);
  }

  async function refresh(): Promise<void> {
    const view = await window.tishka.config.get();
    baseUrl.value = view.config.llm.baseUrl;
    model.value = view.config.llm.model;
    visionModel.value = view.config.llm.visionModel;
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
            visionModel: visionModel.value.trim()
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

  check.addEventListener('click', () => {
    void runWithFeedback(check, CHECK_LABELS, async () => {
      const result = await window.tishka.config.checkGateway({
        baseUrl: baseUrl.value,
        model: model.value.trim(),
        key: key.value.trim()
      });
      if (!result.ok) {
        const error = result.error ?? 'Не удалось проверить шлюз';
        show(error);
        throw new Error(error);
      }
      applyModels(result.models);
      show(undefined, `Шлюз отвечает, модель ${model.value.trim()}, ${result.ms} мс`);
    });
  });

  model.addEventListener('input', () => {
    warnMissing(modelHint, model.value, [...modelList.options].map((option) => option.value));
  });

  visionModel.addEventListener('input', () => {
    warnMissing(visionHint, visionModel.value, [...visionList.options].map((option) => option.value));
  });

  void refresh();

  return { refresh: () => void refresh() };
}
