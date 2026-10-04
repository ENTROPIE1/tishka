import type { ConnectionTemplate } from '../../core/connections';
import type { ConnectionView } from '../../main/ipc-settings';
import { openEditor, TEMPLATE_OPTIONS, templateLabel } from './connection-editor';
import { button, clear, el, field, runWithFeedback, sectionTitle, selectInput } from './dom';

const CHECK_LABELS = { busy: 'Проверяю…', done: 'Готово', error: 'Ошибка' };

function stateLabel(view: ConnectionView): string {
  if (view.state === 'connected') {
    return 'подключён';
  }
  if (view.state === 'error') {
    return 'ошибка';
  }
  return 'отключён';
}

export function mountConnectionsSection(root: HTMLElement): void {
  clear(root);
  root.append(sectionTitle('Подключения'));

  const list = el('div');
  const addHost = el('div');
  const messages = el('div', 'messages');
  const templateSelect = selectInput(TEMPLATE_OPTIONS, 'confluence');
  const addButton = button('Добавить');
  const addRow = el('div', 'row');
  addRow.append(templateSelect, addButton);

  const screenEnabled = el('input', 'checkbox-input');
  screenEnabled.type = 'checkbox';
  const screenField = field(
    'Разрешить смотреть на экран',
    screenEnabled,
    'Снимок делается только по вашей просьбе и уходит в локальную модель ДКС; на диск не сохраняется'
  );

  root.append(list, screenField, addRow, addHost, messages);

  let views: ConnectionView[] = [];

  function names(): string[] {
    return views.map((view) => view.name);
  }

  function showError(error: unknown): void {
    clear(messages);
    messages.append(el('div', 'message-error', error instanceof Error ? error.message : String(error)));
  }

  async function refresh(): Promise<void> {
    try {
      views = await window.tishka.connections.status();
      render();
    } catch (error) {
      showError(error);
    }
  }

  async function refreshScreen(): Promise<void> {
    const view = await window.tishka.config.get();
    screenEnabled.checked = view.config.screen.enabled;
  }

  screenEnabled.addEventListener('change', () => {
    void (async () => {
      try {
        const view = await window.tishka.config.get();
        await window.tishka.config.save({ ...view.config, screen: { enabled: screenEnabled.checked } });
        clear(messages);
        messages.append(
          el('div', 'message-ok', screenEnabled.checked ? 'Смотреть на экран разрешено' : 'Смотреть на экран запрещено')
        );
      } catch (error) {
        screenEnabled.checked = !screenEnabled.checked;
        showError(error);
      }
    })();
  });

  function card(view: ConnectionView): HTMLElement {
    const box = el('div', 'connection');
    const head = el('div', 'connection-head');
    head.append(el('span', 'connection-name', view.name), el('span', 'connection-template', templateLabel(view.template)));
    head.append(el('span', `state state-${view.state}`, stateLabel(view)));
    head.append(el('span', 'connection-tools', `${view.tools} инструментов`));
    box.append(head);

    if (view.address !== '') {
      const address = el('div', 'connection-address', view.address);
      address.title = view.address;
      box.append(address);
    }

    if (view.error !== undefined) {
      box.append(el('div', 'connection-error', view.error));
    }

    const actions = el('div', 'row');
    const check = button('Проверить', 'button button-secondary');
    const edit = button('Изменить', 'button button-secondary');
    const remove = button('Удалить', 'button button-danger');
    actions.append(check, edit, remove);
    box.append(actions);

    const editorHost = el('div');
    box.append(editorHost);

    check.addEventListener('click', () => {
      void runWithFeedback(check, CHECK_LABELS, async () => {
        try {
          await window.tishka.connections.reconnect(view.name);
        } catch (error) {
          showError(error);
          throw error;
        }
      }).then(() => {
        void refresh();
      });
    });

    edit.addEventListener('click', () => {
      openEditor({
        host: editorHost,
        template: view.template,
        previousName: view.name,
        view,
        existingNames: names(),
        onDone: () => {
          void refresh();
        }
      });
    });

    remove.addEventListener('click', () => {
      if (!window.confirm(`Удалить подключение «${view.name}»?`)) {
        return;
      }
      void (async () => {
        try {
          await window.tishka.connections.remove(view.name);
          await refresh();
        } catch (error) {
          showError(error);
        }
      })();
    });

    return box;
  }

  function render(): void {
    clear(list);
    if (views.length === 0) {
      list.append(el('div', 'empty', 'Подключений пока нет'));
    }
    for (const view of views) {
      list.append(card(view));
    }
  }

  addButton.addEventListener('click', () => {
    openEditor({
      host: addHost,
      template: templateSelect.value as ConnectionTemplate,
      existingNames: names(),
      onDone: () => {
        clear(addHost);
        void refresh();
      }
    });
  });

  void refresh();
  void refreshScreen().catch((error: unknown) => {
    showError(error);
  });
}
