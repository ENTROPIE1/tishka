// Просьба посмотреть на экран: одна формулировка для чата и строки ежа.
// Набранный текст становится вопросом к экрану, пустое поле — общей просьбой.

export const LOOK_DEFAULT = 'Посмотри, что у меня на экране';

const LOOK_PREFIX = 'Посмотри на экран. ';

export function lookText(question: string): string {
  return question === '' ? LOOK_DEFAULT : `${LOOK_PREFIX}${question}`;
}

export type ScreenLookAction =
  | { kind: 'send'; text: string }   // запустить просмотр, текст — вопрос к экрану
  | { kind: 'stop' }                 // Тишка смотрит: нажатие останавливает
  | { kind: 'none' };                // занята другой работой или просмотр запрещён

// Решение по нажатию кнопки с глазом: одинаковое в чате и у ежа.
export function screenLookAction(input: {
  looking: boolean;
  busy: boolean;
  available: boolean;
  question: string;
}): ScreenLookAction {
  if (input.looking) {
    return { kind: 'stop' };
  }
  if (input.busy || !input.available) {
    return { kind: 'none' };
  }
  return { kind: 'send', text: lookText(input.question) };
}
