import type { Config } from '../../core/types';
import { button, clear, el, field, sectionTitle, selectInput } from './dom';

type FyrLevel = Config['persona']['fyr'];

const FYR_OPTIONS: Array<{ value: FyrLevel; label: string }> = [
  { value: 'off', label: 'Выключено' },
  { value: 'sometimes', label: 'Иногда' },
  { value: 'often', label: 'Часто' }
];

export function mountPersonaSection(root: HTMLElement): void {
  clear(root);
  root.append(sectionTitle('Характер'));

  const fyr = selectInput(FYR_OPTIONS, 'sometimes');
  const save = button('Сохранить');
  const messages = el('div', 'messages');

  root.append(field('Частота «фыр»', fyr));
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
    fyr.value = view.config.persona.fyr;
  }

  save.addEventListener('click', () => {
    void (async () => {
      save.disabled = true;
      try {
        const view = await window.tishka.config.get();
        const next: Config = {
          ...view.config,
          persona: { fyr: fyr.value as FyrLevel }
        };
        await window.tishka.config.save(next);
        show(undefined, 'Характер сохранён');
      } catch (error) {
        show(error instanceof Error ? error.message : String(error));
      } finally {
        save.disabled = false;
      }
    })();
  });

  void refresh();
}
