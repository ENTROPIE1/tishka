import type { ConnectionTemplate } from '../../core/connections';
import type { ConnectionView } from '../../main/ipc-settings';
import { askConfirm } from '../shared/app-confirm';
import { openEditor, TEMPLATE_OPTIONS, templateLabel } from './connection-editor';
import { button, clear, el, field, runWithFeedback, sectionTitle, selectInput, type SettingsSection } from './dom';

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

export function mountConnectionsSection(root: HTMLElement): SettingsSection {
  clear(root);
  root.append(sectionTitle('Серверы MCP'));
  root.append(
    el(
      'p',
      'field-hint',
      'Готовые: Confluence, Exchange, Jira. Свой MCP — stdio или HTTP (например, база только на SELECT). Имя в карточке — то, что стоит в навыке: exchange, confluence, jira.'
    )
  );

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

  root.append(list, sectionTitle('Экран'), screenField, addRow, addHost, messages);

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
    head.append(
      el('span', 'connection-name', templateLabel(view.template)),
      el('span', 'connection-template', view.name)
    );
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

    // Переключатель подтверждения меняющих инструментов этого подключения.
    const confirm = el('input', 'checkbox-input');
    confirm.type = 'checkbox';
    confirm.checked = view.confirmChanges !== false;
    const confirmField = field('Спрашивать перед изменениями', confirm);
    confirm.addEventListener('change', () => {
      void (async () => {
        try {
          // Меняем только настройку подтверждения: подключение целиком не
          // пересобираем, чтобы не задеть секреты и адрес.
          const current = await window.tishka.config.get();
          const servers = current.config.mcpServers.map((server) =>
            server.name === view.name ? { ...server, confirmChanges: confirm.checked } : server
          );
          await window.tishka.config.save({ ...current.config, mcpServers: servers });
          await refresh();
        } catch (error) {
          confirm.checked = !confirm.checked;
          showError(error);
        }
      })();
    });
    box.append(confirmField);

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
      void (async () => {
        if (!(await askConfirm(`Удалить подключение «${view.name}»?`))) {
          return;
        }
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
    // Открытый редактор не закрываем: он живёт внутри карточки списка.
    if (list.querySelector('.editor') !== null) {
      return;
    }
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

  return {
    refresh: () => {
      void refresh();
      void refreshScreen().catch((error: unknown) => {
        showError(error);
      });
    }
  };
}
