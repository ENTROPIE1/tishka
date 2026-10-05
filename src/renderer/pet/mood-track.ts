// Эмоция лица нового персонажа. Настроение ответа задаёт её в начале реплики,
// метки посреди реплики меняют по ходу речи, покой и уход возвращают neutral.
// Прежний ёж не реализует setMood: для него все вызовы ничего не делают.

import type { Mood } from '../../core/types';
import type { PetState } from '../../pet/state';

export interface MoodTarget {
  setMood?(name: string): void;
}

const REST_STATES: readonly PetState[] = ['idle', 'leave', 'hidden', 'sleep'];

export interface MoodTrack {
  reply(mood: Mood | undefined): void;   // настроение ответа в начале реплики
  mark(name: string): void;              // метка внутри реплики
  state(state: PetState): void;          // покой и уход сбрасывают эмоцию
  apply(): void;                         // вернуть текущую эмоцию новому лицу
}

export function createMoodTrack(target: MoodTarget): MoodTrack {
  let current: string | undefined;

  function set(name: string): void {
    if (current === name) {
      return;
    }
    current = name;
    target.setMood?.(name);
  }

  return {
    reply: (mood) => set(mood ?? 'neutral'),
    mark: (name) => set(name),
    state: (state) => {
      if (REST_STATES.includes(state)) {
        set('neutral');
      }
    },
    apply: () => {
      if (current !== undefined) {
        target.setMood?.(current);
      }
    }
  };
}
