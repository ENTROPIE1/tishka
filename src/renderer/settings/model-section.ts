import type { Config } from '../../core/types';
import { button, clear, el, field, runWithFeedback, sectionTitle, textInput, type SettingsSection } from './dom';

const SAVE_LABELS = { busy: 'Сохраняю…', done: 'Готово', error: 'Ошибка' };
const API_KEY_SECRET = 'DKS_API_KEY';
const KEY_SET = 'Ключ задан';
const KEY_MISSING = 'Ключ не задан';

export function mountModelSection(root: HTMLElement): SettingsSection {
  clear(root);
  root.append(sectionTitle('Модель'));

  const baseUrl = textInput();
  const model = textInput();
  const visionModel = textInput();
  const key = textInput('', 'password');
  const keyState = el('span', 'field-hint', KEY_MISSING);
  const save = button('Сохранить');
  const messages = el('div', 'messages');

  root.append(
    field('Адрес шлюза', baseUrl),
    field('Модель', model),
    field('Модель для картинок', visionModel),
    field('Ключ шлюза', key, 'Сохранённый ключ не показывается; пустое поле оставляет прежний ключ'),
    field('Состояние ключа', keyState)
  );
  const actions = el('div', 'row');
  actions.append(save);
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

  async function refresh(): Promise<void> {
    const view = await window.tishka.config.get();
    baseUrl.value = view.config.llm.baseUrl;
    model.value = view.config.llm.model;
    visionModel.value = view.config.llm.visionModel;
    keyState.textContent = view.gatewayKeySet ? KEY_SET : KEY_MISSING;
  }

  save.addEventListener('click', () => {
    void runWithFeedback(save, SAVE_LABELS, async () => {
      try {
        const view = await window.tishka.config.get();
        const next: Config = {
          ...view.config,
          llm: {
            baseUrl: baseUrl.value.trim(),
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

  void refresh();

  return { refresh: () => void refresh() };
}
