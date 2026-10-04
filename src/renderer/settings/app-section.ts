import type { Config } from '../../core/types';
import { button, checkboxField, clear, el, field, runWithFeedback, sectionTitle, textInput, type SettingsSection } from './dom';

const SAVE_LABELS = { busy: 'Сохраняю…', done: 'Готово', error: 'Ошибка' };

function parsePositive(value: string, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : fallback;
}

export function mountAppSection(root: HTMLElement): SettingsSection {
  clear(root);
  root.append(sectionTitle('Приложение'));

  const autostart = el('input', 'checkbox-input');
  autostart.type = 'checkbox';
  const warmMinutes = textInput('', 'number');
  const memoryLimit = textInput('', 'number');
  const save = button('Сохранить');
  const messages = el('div', 'messages');

  root.append(
    checkboxField('Запускать вместе с Windows', autostart, 'Приложение стартует свёрнутым в область уведомлений'),
    field('Держать микрофон наготове, минут', warmMinutes, 'Столько микрофон остаётся открытым после последнего обращения'),
    field('Предел памяти, МБ', memoryLimit, 'При превышении в простое окна перезагружаются, затем приложение перезапускается')
  );
  const actions = el('div', 'row');
  actions.append(save);
  root.append(actions, messages);

  function show(error?: string, ok?: string): void {
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
    autostart.checked = view.config.app.autostart;
    warmMinutes.value = String(view.config.app.warmMinutes);
    memoryLimit.value = String(view.config.app.memoryLimitMb);
  }

  save.addEventListener('click', () => {
    void runWithFeedback(save, SAVE_LABELS, async () => {
      try {
        const view = await window.tishka.config.get();
        const next: Config = {
          ...view.config,
          app: {
            autostart: autostart.checked,
            warmMinutes: parsePositive(warmMinutes.value, view.config.app.warmMinutes),
            memoryLimitMb: parsePositive(memoryLimit.value, view.config.app.memoryLimitMb)
          }
        };
        await window.tishka.config.save(next);
        show(undefined, 'Настройки приложения сохранены');
      } catch (error) {
        show(error instanceof Error ? error.message : String(error));
        throw error;
      }
    });
  });

  void refresh();

  return { refresh: () => void refresh() };
}
