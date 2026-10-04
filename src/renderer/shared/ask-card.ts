import { createMicButton } from './mic-button';
import { insertAtCursor } from './text-insert';

export interface AskRequest {
  title: string;
  placeholder?: string;
}

export interface AskCardActions {
  onSend: (text: string) => void;
  onCancel: () => void;
}

export const ASK_MAX_LENGTH = 20000;

function button(label: string, className: string): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  node.textContent = label;
  return node;
}

// Карточка ввода одинакова в чате и в окне-питомце: заголовок, большое поле
// и кнопки. Лишний текст не отправляется, после отправки карточка сообщает о ней.
export function askCardElement(ask: AskRequest, actions: AskCardActions): HTMLElement {
  const card = document.createElement('div');
  card.className = 'card ask-card';

  const head = document.createElement('div');
  head.className = 'card-head';
  const title = document.createElement('div');
  title.className = 'card-title';
  title.textContent = ask.title;
  head.append(title);

  const body = document.createElement('div');
  body.className = 'card-body ask-body';

  const field = document.createElement('textarea');
  field.className = 'ask-input';
  field.rows = 8;
  if (ask.placeholder !== undefined && ask.placeholder !== '') {
    field.placeholder = ask.placeholder;
  }

  const hint = document.createElement('div');
  hint.className = 'ask-hint';
  hint.textContent = 'Слишком длинный текст';
  hint.hidden = true;
  body.append(field, hint);

  // Диктовка доступна, когда карточка живёт в окне приложения.
  if ('tishka' in window) {
    const tools = document.createElement('div');
    tools.className = 'ask-tools';
    const mic = createMicButton({
      onText: (text) => {
        insertAtCursor(field, text);
        refresh();
      },
      onLevel: () => undefined,
      onListeningChange: (listening) => {
        tools.classList.toggle('listening', listening);
      }
    });
    tools.append(mic.element);
    body.append(tools);
  }

  const row = document.createElement('div');
  row.className = 'card-actions';
  const cancel = button('Отмена', 'card-copy ask-cancel');
  const send = button('Отправить', 'card-copy ask-send');
  row.append(cancel, send);

  card.append(head, body, row);

  let sent = false;

  function tooLong(): boolean {
    return field.value.length > ASK_MAX_LENGTH;
  }

  function refresh(): void {
    const long = tooLong();
    hint.hidden = !long;
    send.disabled = long;
  }

  function sendText(): void {
    const text = field.value.trim();
    if (text === '' || tooLong()) {
      return;
    }
    sent = true;
    actions.onSend(text);
    card.replaceChildren();
    const done = document.createElement('div');
    done.className = 'ask-sent';
    done.textContent = 'Текст отправлен';
    card.append(done);
  }

  field.addEventListener('input', refresh);
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      sendText();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      actions.onCancel();
    }
  });
  cancel.addEventListener('click', actions.onCancel);
  send.addEventListener('click', sendText);

  refresh();
  // Поле получает фокус после того, как карточку вставят в документ.
  queueMicrotask(() => {
    if (!sent) {
      field.focus();
    }
  });

  return card;
}
