import type { PetState } from '../../pet/state';

// Видимая подпись состояния справа от ёжика. Для прочих состояний строка пустая.
const LABELS: Partial<Record<PetState, string>> = {
  appear: 'ждёт',
  idle: 'ждёт',
  listening: 'слушает',
  thinking: 'думает',
  working: 'думает'
};

// Пока служба распознавания не готова, «слушает» обещать нельзя.
// Во время приветствия подпись согласована с облачком: «говорит».
export function stateLabel(state: PetState, waiting = false, greeting = false): string {
  if (greeting) {
    return 'говорит';
  }
  if (waiting && state === 'listening') {
    return 'ждёт';
  }
  return LABELS[state] ?? '';
}
