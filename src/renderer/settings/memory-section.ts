import type { MemoryRecord } from '../../core/memory/store';
import { button, clear, el, sectionTitle, textInput, type SettingsSection } from './dom';
import { createMemoryEditor } from './memory-editor';

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
];

// Дата изменения: «сегодня, 9:47» для текущего дня, иначе «3 октября».
export function memoryDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const time = `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return `сегодня, ${time}`;
  }
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

function reviewLabel(record: MemoryRecord): string | undefined {
  if (record.reviewAt === undefined) {
    return undefined;
  }
  return `проверить: ${record.reviewAt.slice(0, 10)}`;
}

function metaText(record: MemoryRecord): string {
  const parts = [record.tags.join(', '), reviewLabel(record), memoryDate(record.updated)];
  return parts.filter((part) => part !== undefined && part !== '').join(' · ');
}

function byUpdated(a: MemoryRecord, b: MemoryRecord): number {
  return Date.parse(b.updated) - Date.parse(a.updated);
}

export function mountMemorySection(root: HTMLElement): SettingsSection {
  clear(root);
  root.append(sectionTitle('Память'));

  const search = textInput('', 'search');
  search.placeholder = 'Поиск по памяти';
  const forgetAll = button('Забыть всё', 'button button-danger');
  const list = el('div', 'memory-list');
  const messages = el('div', 'messages');
  const actions = el('div', 'row');
  actions.append(search, forgetAll);
  root.append(actions, list, messages);

  let query = '';
  let editor: HTMLElement | undefined;

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
    try {
      const records = query === '' ? await window.tishka.memory.list() : await window.tishka.memory.search(query);
      render(records);
    } catch (error) {
      show(error instanceof Error ? error.message : String(error));
    }
  }

  // Снимаем редактор и сразу перечитываем список из хранилища.
  function closeEditor(): void {
    editor?.remove();
    editor = undefined;
    void refresh();
  }

  async function removeRecord(id: string): Promise<void> {
    try {
      await window.tishka.memory.remove(id);
      show(undefined, 'Запись забыта');
      await refresh();
    } catch (error) {
      show(error instanceof Error ? error.message : String(error));
    }
  }

  function openEditor(record: MemoryRecord): void {
    if (editor !== undefined) {
      return;
    }
    clear(list);
    editor = createMemoryEditor({ record, onMessage: show, onClose: closeEditor });
    list.append(editor);
  }

  function renderItem(record: MemoryRecord): HTMLElement {
    const wrapper = el('div', 'memory-item');
    wrapper.append(el('div', 'memory-item-text', record.text));
    const meta = metaText(record);
    if (meta !== '') {
      wrapper.append(el('div', 'memory-item-meta', meta));
    }
    const edit = button('Изменить', 'button button-secondary');
    const forget = button('Забыть', 'button button-danger');
    edit.addEventListener('click', () => {
      openEditor(record);
    });
    forget.addEventListener('click', () => {
      void removeRecord(record.id);
    });
    const itemActions = el('div', 'memory-item-actions');
    itemActions.append(edit, forget);
    wrapper.append(itemActions);
    return wrapper;
  }

  function render(records: MemoryRecord[]): void {
    // Редактор мог снять экран (Esc в оболочке) — тогда считаем его закрытым.
    if (editor !== undefined && editor.parentNode === null) {
      editor = undefined;
    }
    // Пока редактор открыт, не затираем введённый текст; после закрытия список
    // перечитывается заново через closeEditor().
    if (editor !== undefined) {
      return;
    }
    clear(list);
    if (records.length === 0) {
      list.append(el('div', 'empty', 'Записей нет'));
      return;
    }
    for (const record of [...records].sort(byUpdated)) {
      list.append(renderItem(record));
    }
  }

  search.addEventListener('input', () => {
    query = search.value.trim();
    void refresh();
  });

  forgetAll.addEventListener('click', () => {
    void (async () => {
      if (!window.confirm('Забыть все записи памяти?')) {
        return;
      }
      try {
        await window.tishka.memory.clear();
        show(undefined, 'Память очищена');
        await refresh();
      } catch (error) {
        show(error instanceof Error ? error.message : String(error));
      }
    })();
  });

  // Об изменении памяти сообщает ядро; открытый редактор при этом не трогаем.
  window.tishka.onEvent((event) => {
    if (event.type === 'memory.changed') {
      void refresh();
    }
  });

  void refresh();

  return { refresh: () => void refresh() };
}
