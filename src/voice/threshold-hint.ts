export const THRESHOLD_HINT = 'Слушаю без пауз слишком долго. Поднимите порог громкости на экране „Голос“';

const LIMIT_PHRASES_BEFORE_HINT = 3;

export interface ThresholdHintDeps {
  report(): void;
}

export interface ThresholdHint {
  // Отрезок прослушивания упёрся в предел длины.
  limit(): void;
  // Фраза закончилась сама: серия прервана.
  ended(): void;
}

// Три отрезка подряд без тишины — звук на фоне выше порога. Подсказка поднять
// порог показывается один раз за запуск.
export function createThresholdHint(deps: ThresholdHintDeps): ThresholdHint {
  let streak = 0;
  let shown = false;
  return {
    limit(): void {
      streak += 1;
      if (streak >= LIMIT_PHRASES_BEFORE_HINT && !shown) {
        shown = true;
        deps.report();
      }
    },
    ended(): void {
      streak = 0;
    }
  };
}
