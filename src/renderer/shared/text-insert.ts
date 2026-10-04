// Вставка текста в поле в место курсора с пробелом перед ним, если нужно.
export function insertAtCursor(field: HTMLTextAreaElement | HTMLInputElement, text: string): void {
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? start;
  const before = field.value.slice(0, start);
  const after = field.value.slice(end);
  const prefix = before !== '' && !/\s$/.test(before) ? ' ' : '';
  const insertion = prefix + text;
  field.value = before + insertion + after;
  const caret = before.length + insertion.length;
  field.setSelectionRange(caret, caret);
  field.focus();
}
