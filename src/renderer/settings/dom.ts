export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

export interface SettingsSection {
  refresh(): void;
}

// Несколько разделов на одном экране обновляются вместе.
export function combineSections(sections: SettingsSection[]): SettingsSection {
  return {
    refresh(): void {
      for (const section of sections) {
        section.refresh();
      }
    }
  };
}

export function sectionTitle(text: string): HTMLElement {
  return el('h2', 'section-title', text);
}

export function button(label: string, className = 'button'): HTMLButtonElement {
  const node = el('button', className, label);
  node.type = 'button';
  return node;
}

export interface FeedbackLabels {
  busy: string;
  done: string;
  error: string;
}

function setButtonContent(button: HTMLButtonElement, markClass: string, mark: string, label: string): void {
  const badge = el('span', markClass, mark);
  button.replaceChildren(badge, document.createTextNode(` ${label}`));
}

// Долгое действие кнопки: вращающийся значок и текст «...», затем на 2 секунды
// «Готово» или «Ошибка», после чего прежний текст. Ошибку показывает вызывающий.
export async function runWithFeedback(
  button: HTMLButtonElement,
  labels: FeedbackLabels,
  action: () => Promise<void>
): Promise<boolean> {
  const original = button.textContent ?? '';
  button.disabled = true;
  setButtonContent(button, 'spinner', '', labels.busy);
  let ok = false;
  try {
    await action();
    ok = true;
  } catch {
    ok = false;
  }
  setButtonContent(button, ok ? 'mark-ok' : 'mark-error', ok ? '✓' : '✕', ok ? labels.done : labels.error);
  button.classList.add(ok ? 'btn-done' : 'btn-error');
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 2000);
  });
  button.classList.remove('btn-done', 'btn-error');
  button.textContent = original;
  button.disabled = false;
  return ok;
}

export function textInput(value = '', type = 'text'): HTMLInputElement {
  const node = el('input', 'text-input');
  node.type = type;
  node.value = value;
  return node;
}

export function field(label: string, input: HTMLElement, hint?: string): HTMLElement {
  const wrapper = el('label', 'field');
  wrapper.append(el('span', 'field-label', label), input);
  if (hint !== undefined) {
    wrapper.append(el('span', 'field-hint', hint));
  }
  return wrapper;
}

export function selectInput(options: Array<{ value: string; label: string }>, value: string): HTMLSelectElement {
  const node = el('select', 'select-input');
  for (const option of options) {
    const item = el('option', undefined, option.label);
    item.value = option.value;
    node.append(item);
  }
  node.value = value;
  return node;
}

export function textarea(value = '', placeholder = ''): HTMLTextAreaElement {
  const node = el('textarea', 'textarea-input');
  node.value = value;
  node.placeholder = placeholder;
  return node;
}
