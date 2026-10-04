import type { MemoryRecord } from '../../core/memory/store';
import { button, el, field, textInput, textarea } from './dom';

export function parseMemoryTags(value: string): string[] {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
}

export interface MemoryEditorOptions {
  record: MemoryRecord;
  onMessage(error?: string, ok?: string): void;
  onClose(): void;
}

// Редактор записи памяти: сохраняет, отменяет и закрывается по Esc сам.
// Закрытие (снятие с экрана и перечитывание списка) делает вызывающий.
export function createMemoryEditor(options: MemoryEditorOptions): HTMLElement {
  const { record } = options;
  const textValue = textarea(record.text);
  const textField = field('Текст', textValue);
  const textHint = el('span', 'field-hint');
  textField.append(textHint);
  const tagsValue = textInput(record.tags.join(', '));
  const save = button('Сохранить');
  const cancel = button('Отмена', 'button button-secondary');
  const buttons = el('div', 'row');
  buttons.append(save, cancel);
  const editor = el('div', 'editor');
  editor.append(textField, field('Метки через запятую', tagsValue), buttons);

  textValue.addEventListener('input', () => {
    textHint.textContent = '';
  });

  save.addEventListener('click', () => {
    void (async () => {
      const value = textValue.value.trim();
      if (value === '') {
        textHint.textContent = 'Текст записи не может быть пустым';
        textValue.focus();
        return;
      }
      textHint.textContent = '';
      save.disabled = true;
      save.textContent = 'Сохраняю…';
      try {
        const current = await window.tishka.memory.list();
        const existing = current.find((item) => item.id === record.id);
        if (existing === undefined) {
          options.onMessage('Запись уже удалена — правка не сохранена');
          return;
        }
        if (existing.updated !== record.updated) {
          options.onMessage('Запись изменилась — откройте её заново');
          return;
        }
        await window.tishka.memory.update(record.id, { text: value, tags: parseMemoryTags(tagsValue.value) });
        options.onMessage(undefined, 'Запись обновлена');
        options.onClose();
      } catch (error) {
        options.onMessage(error instanceof Error ? error.message : String(error));
      } finally {
        save.disabled = false;
        save.textContent = 'Сохранить';
      }
    })();
  });

  cancel.addEventListener('click', () => {
    options.onClose();
  });

  // Esc закрывает редактор; перехватываем до обработчика экрана, чтобы он не
  // ушёл в чат. Сторожимся только пока редактор ещё на экране.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !editor.isConnected) {
      return;
    }
    event.stopImmediatePropagation();
    event.preventDefault();
    options.onClose();
  }, true);

  return editor;
}
