import type { Config } from '../../core/types';
import { hedgehogMarkup } from '../pet/svg-hedgehog-markup';
import { button, clear, el, field, runWithFeedback, sectionTitle, selectInput, type SettingsSection } from './dom';

type FyrLevel = Config['persona']['fyr'];
type CharacterKind = Config['persona']['character'];

const SAVE_LABELS = { busy: 'Сохраняю…', done: 'Готово', error: 'Ошибка' };

const FYR_OPTIONS: Array<{ value: FyrLevel; label: string }> = [
  { value: 'off', label: 'Выключено' },
  { value: 'sometimes', label: 'Иногда' },
  { value: 'often', label: 'Часто' }
];

const CHARACTERS: Array<{ kind: CharacterKind; label: string }> = [
  { kind: 'hedgehog', label: 'Первый ёж' },
  { kind: 'tishka', label: 'Тишка' }
];

function thumbnail(kind: CharacterKind): HTMLElement {
  const box = el('div', 'appearance-thumb');
  if (kind === 'tishka') {
    const img = el('img');
    img.src = '../model/layers/reference_full.png';
    img.alt = '';
    box.append(img);
  } else {
    box.innerHTML = hedgehogMarkup();
  }
  return box;
}

export function mountPersonaSection(root: HTMLElement): SettingsSection {
  clear(root);
  root.append(sectionTitle('Характер'));

  let currentCharacter: CharacterKind = 'hedgehog';

  const cards = new Map<CharacterKind, HTMLButtonElement>();
  const appearance = el('div', 'appearance');
  appearance.append(el('div', 'section-subtitle', 'Внешность'));
  const cardRow = el('div', 'appearance-cards');
  for (const item of CHARACTERS) {
    const card = button(item.label, 'appearance-card');
    card.prepend(thumbnail(item.kind));
    card.addEventListener('click', () => {
      void choose(item.kind);
    });
    cards.set(item.kind, card);
    cardRow.append(card);
  }
  appearance.append(cardRow);
  root.append(appearance);

  const fyr = selectInput(FYR_OPTIONS, 'sometimes');
  const save = button('Сохранить');
  const messages = el('div', 'messages');

  root.append(field('Частота «фыр»', fyr));
  const actions = el('div', 'row');
  actions.append(save);
  root.append(actions, messages);

  function renderActive(): void {
    for (const [kind, card] of cards) {
      card.classList.toggle('is-active', kind === currentCharacter);
      card.setAttribute('aria-pressed', kind === currentCharacter ? 'true' : 'false');
    }
  }

  function show(error: string | undefined, ok?: string): void {
    clear(messages);
    if (error !== undefined) {
      messages.append(el('div', 'message-error', error));
    }
    if (ok !== undefined) {
      messages.append(el('div', 'message-ok', ok));
    }
  }

  // Персонаж применяется сразу, без перезапуска: окно ежа пересоздаёт его.
  async function choose(kind: CharacterKind): Promise<void> {
    if (kind === currentCharacter) {
      return;
    }
    try {
      const view = await window.tishka.config.get();
      await window.tishka.config.save({
        ...view.config,
        persona: { ...view.config.persona, character: kind }
      });
      currentCharacter = kind;
      renderActive();
      show(undefined, 'Внешность изменена');
    } catch (error) {
      show(error instanceof Error ? error.message : String(error));
    }
  }

  async function refresh(): Promise<void> {
    const view = await window.tishka.config.get();
    currentCharacter = view.config.persona.character;
    fyr.value = view.config.persona.fyr;
    renderActive();
  }

  save.addEventListener('click', () => {
    void runWithFeedback(save, SAVE_LABELS, async () => {
      try {
        const view = await window.tishka.config.get();
        const next: Config = {
          ...view.config,
          persona: { fyr: fyr.value as FyrLevel, character: currentCharacter }
        };
        await window.tishka.config.save(next);
        show(undefined, 'Характер сохранён');
      } catch (error) {
        show(error instanceof Error ? error.message : String(error));
        throw error;
      }
    });
  });

  void refresh();
  renderActive();

  return { refresh: () => void refresh() };
}
