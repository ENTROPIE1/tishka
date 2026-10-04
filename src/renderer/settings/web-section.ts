import { clear, el, field, type SettingsSection } from './dom';

// Переключатель чтения страниц стоит на экране «Подключения» под списком.
export function mountWebSection(root: HTMLElement): SettingsSection {
  clear(root);

  const enabled = el('input', 'checkbox-input');
  enabled.type = 'checkbox';
  const wrapper = field(
    'Читать страницы из интернета',
    enabled,
    'Тишка открывает страницы без ваших входов и паролей; внутренние адреса не читает'
  );
  const messages = el('div', 'messages');
  root.append(wrapper, messages);

  function showError(error: unknown): void {
    clear(messages);
    messages.append(el('div', 'message-error', error instanceof Error ? error.message : String(error)));
  }

  async function refresh(): Promise<void> {
    const view = await window.tishka.config.get();
    enabled.checked = view.config.web.enabled;
  }

  enabled.addEventListener('change', () => {
    void (async () => {
      try {
        const view = await window.tishka.config.get();
        await window.tishka.config.save({ ...view.config, web: { enabled: enabled.checked } });
        clear(messages);
        messages.append(
          el('div', 'message-ok', enabled.checked ? 'Чтение страниц разрешено' : 'Чтение страниц запрещено')
        );
      } catch (error) {
        enabled.checked = !enabled.checked;
        showError(error);
      }
    })();
  });

  void refresh().catch(showError);

  return {
    refresh: () => {
      void refresh().catch(showError);
    }
  };
}
