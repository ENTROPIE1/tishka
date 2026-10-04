import type { PetState } from '../../pet/state';

// Видимая подпись состояния под ёжиком. Для прочих состояний строка пустая,
// но место под неё сохраняется, чтобы ёжик не прыгал по вертикали.
const LABELS: Partial<Record<PetState, string>> = {
  appear: 'ждёт',
  idle: 'ждёт',
  listening: 'слушает',
  thinking: 'думает',
  working: 'думает'
};

// Пока служба распознавания не готова, «слушает» обещать нельзя.
export function stateLabel(state: PetState, waiting = false): string {
  if (waiting && state === 'listening') {
    return 'ждёт';
  }
  return LABELS[state] ?? '';
}
