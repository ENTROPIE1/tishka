import type { PetState } from '../../pet/state';

// Свёрнутая полочка: сон и уведомление.
export function composerCollapsed(state: PetState): boolean {
  return state === 'sleep' || state === 'notify';
}

// Пока ёж думает или работает, отправка встаёт в очередь, но поле не блокируется.
export function composerBusy(state: PetState): boolean {
  return state === 'thinking' || state === 'working';
}
