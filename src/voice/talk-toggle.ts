// Решение о том, что делает явный щелчок по микрофону: выключает разговор
// своего окна, забирает его у другого окна или включает заново.
// Неготовность службы распознавания не молчит — показываем причину.

export const NOT_READY_MESSAGE = 'Распознавание речи не настроено';

export type TalkSurface = 'pet' | 'chat';
export type ToggleAction = 'enable' | 'disable' | 'not-ready';

export interface ToggleState {
  conversation: boolean;
  owner: TalkSurface | null;
  suppressed: boolean;   // человек выключил микрофон до конца появления
  ready: boolean;        // служба распознавания готова
  starting: boolean;     // служба ещё поднимается: щелчок ждёт готовности, а не ошибка
}

export interface TogglePlan {
  action: ToggleAction;
  suppressed: boolean;   // состояние флага после действия
}

export function planToggle(state: ToggleState, by: TalkSurface): TogglePlan {
  if (state.conversation && state.owner === by) {
    return { action: 'disable', suppressed: by === 'pet' ? true : state.suppressed };
  }
  // Пока служба поднимается, щелчок не ошибка: включение откладывается до готовности.
  if (!state.ready && !state.starting && by === 'pet') {
    return { action: 'not-ready', suppressed: state.suppressed };
  }
  // Явное включение щелчком снимает запрет на автоматическое включение.
  return { action: 'enable', suppressed: by === 'pet' ? false : state.suppressed };
}
