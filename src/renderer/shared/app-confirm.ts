export interface AskConfirmOptions {
  host?: HTMLElement;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

// Окно подтверждения в стиле приложения: карточка на затемнении, кнопки как
// в настройках. Системный window.confirm не используем — он чужой платформе.
export function askConfirm(text: string, options: AskConfirmOptions = {}): Promise<boolean> {
  const host = options.host ?? document.body;
  const confirmLabel = options.confirmLabel ?? 'Удалить';
  const cancelLabel = options.cancelLabel ?? 'Отмена';
  const danger = options.danger !== false;

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'app-confirm-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const card = document.createElement('div');
    card.className = 'app-confirm';
    const message = document.createElement('p');
    message.className = 'app-confirm-text';
    message.textContent = text;
    const actions = document.createElement('div');
    actions.className = 'app-confirm-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'button button-secondary';
    cancel.textContent = cancelLabel;
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = danger ? 'button button-danger' : 'button';
    ok.textContent = confirmLabel;
    actions.append(cancel, ok);
    card.append(message, actions);
    overlay.append(card);

    let done = false;
    function finish(value: boolean): void {
      if (done) {
        return;
      }
      done = true;
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(value);
    }

    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    }

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        finish(false);
      }
    });
    cancel.addEventListener('click', () => finish(false));
    ok.addEventListener('click', () => finish(true));
    document.addEventListener('keydown', onKey);
    host.append(overlay);
    ok.focus();
  });
}
