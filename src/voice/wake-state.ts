// Явное состояние Тишки вокруг голоса. Заменяет прежний набор
// взаимозависимых флагов («разговор», «отвечает» и прочие): переходы описаны
// одной таблицей, поэтому неверное сочетание состояний невозможно.
//
//   idle      — Тишка свободен, разговор выключен
//   summoned  — услышал имя без просьбы: показывает запись и слушает дальше
//   listening — разговор включён, ждёт фразу
//   busy      — фраза ушла в ядро, Тишка думает или работает
//   speaking  — звучит речь Тишки
//
// «Занят» — busy или speaking: в это время в ядро ничего не уходит.

export type WakeState = 'idle' | 'summoned' | 'listening' | 'busy' | 'speaking';

export type WakeStateEvent =
  | 'summon'       // обращение по имени без просьбы: начали слушать
  | 'listen'       // разговор включён или ход закончился при включённом разговоре
  | 'answer'       // фраза ушла в ядро
  | 'speak'        // Тишка заговорил
  | 'speech-end'   // речь Тишки кончилась
  | 'disable';     // разговор выключен или ход закончился без разговора

type TransitionTable = Record<WakeState, Partial<Record<WakeStateEvent, WakeState>>>;

// Речь переводит в speaking только занятого Тишку: приветствие и готовая
// реплика вне ответа состояние не трогают, иначе оно застряло бы в busy.
const TABLE: TransitionTable = {
  idle: {
    summon: 'summoned',
    listen: 'listening',
    answer: 'busy'
  },
  summoned: {
    summon: 'summoned',
    listen: 'listening',
    answer: 'busy'
  },
  listening: {
    summon: 'summoned',
    listen: 'listening',
    answer: 'busy',
    disable: 'idle'
  },
  busy: {
    answer: 'busy',
    speak: 'speaking',
    'speech-end': 'busy',
    listen: 'listening',
    disable: 'idle'
  },
  speaking: {
    answer: 'busy',
    speak: 'speaking',
    'speech-end': 'busy',
    listen: 'listening',
    disable: 'idle'
  }
};

export interface WakeStateMachine {
  state(): WakeState;
  // Тишка занят: думает, работает или говорит — в ядро ничего не уходит.
  busy(): boolean;
  transition(event: WakeStateEvent): WakeState;
}

export function createWakeState(initial: WakeState = 'idle'): WakeStateMachine {
  let state = initial;
  return {
    state: () => state,
    busy: () => state === 'busy' || state === 'speaking',
    transition(event: WakeStateEvent): WakeState {
      const next = TABLE[state][event];
      if (next !== undefined) {
        state = next;
      }
      return state;
    }
  };
}
