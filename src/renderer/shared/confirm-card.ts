export interface ConfirmCardRequest {
  id: string;
  text: string;
}

export interface ConfirmCardActions {
  onAnswer(yes: boolean): void;
}

function button(label: string, className: string): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  node.textContent = label;
  return node;
}

// Карточка вопроса подтверждения: строка «Выполнить …?» и две кнопки. После
// ответа кнопки гаснут, чтобы второй раз не нажать.
export function confirmCardElement(request: ConfirmCardRequest, actions: ConfirmCardActions): HTMLElement {
  const card = document.createElement('div');
  card.className = 'card confirm-card';

  const body = document.createElement('div');
  body.className = 'card-body confirm-body';
  const text = document.createElement('div');
  text.className = 'confirm-text';
  text.textContent = request.text;
  body.append(text);

  const row = document.createElement('div');
  row.className = 'card-actions confirm-actions';
  const yes = button('Да', 'card-copy confirm-yes');
  const no = button('Нет', 'card-copy confirm-no');
  row.append(yes, no);

  let answered = false;
  function answer(value: boolean): void {
    if (answered) {
      return;
    }
    answered = true;
    yes.disabled = true;
    no.disabled = true;
    actions.onAnswer(value);
  }

  yes.addEventListener('click', () => answer(true));
  no.addEventListener('click', () => answer(false));

  card.append(body, row);
  return card;
}
