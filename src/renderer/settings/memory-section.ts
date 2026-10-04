import type { MemoryRecord } from '../../core/memory/store';
import { button, clear, el, field, sectionTitle, textInput, textarea } from './dom';

function reviewLabel(record: MemoryRecord): string | undefined {
  if (record.reviewAt === undefined) {
    return undefined;
  }
  return `проверить: ${record.reviewAt.slice(0, 10)}`;
}

function metaText(record: MemoryRecord): string {
  return [record.tags.join(', '), reviewLabel(record)].filter((part) => part !== undefined && part !== '').join(' · ');
}

export function mountMemorySection(root: HTMLElement): void {
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
    clear(list);
    const text = textarea(record.text);
    const tags = textInput(record.tags.join(', '));
    const save = button('Сохранить');
    const cancel = button('Отмена', 'button button-secondary');
    const buttons = el('div', 'row');
    buttons.append(save, cancel);
    const editor = el('div', 'editor');
    editor.append(
      field('Текст', text),
      field('Метки через запятую', tags),
      buttons
    );

    save.addEventListener('click', () => {
      void (async () => {
        const parsedTags = tags.value
          .split(',')
          .map((tag) => tag.trim())
          .filter((tag) => tag !== '');
        try {
          await window.tishka.memory.update(record.id, { text: text.value, tags: parsedTags });
          show(undefined, 'Запись обновлена');
          await refresh();
        } catch (error) {
          show(error instanceof Error ? error.message : String(error));
        }
      })();
    });
    cancel.addEventListener('click', () => {
      void refresh();
    });

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
    clear(list);
    if (records.length === 0) {
      list.append(el('div', 'empty', 'Записей нет'));
      return;
    }
    for (const record of records) {
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

  void refresh();
}
