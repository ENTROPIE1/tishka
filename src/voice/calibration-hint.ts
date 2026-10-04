export const CALIBRATION_HINT = 'Плохо слышу. Откалибруйте микрофон в разделе „Голос“';

const MISSES_BEFORE_HINT = 3;

export interface CalibrationHintDeps {
  isCalibrated(): boolean;
  report(): void;
}

export interface CalibrationHint {
  // Отмечает «Не расслышал» или запись без речи; подсказка выдаётся один раз.
  missed(): void;
  reset(): void;
}

// Подсказка показывается один раз за запуск после трёх промахов подряд и только
// если калибровки ещё не было.
export function createCalibrationHint(deps: CalibrationHintDeps): CalibrationHint {
  let streak = 0;
  let shown = false;
  return {
    missed(): void {
      if (deps.isCalibrated()) {
        streak = 0;
        return;
      }
      streak += 1;
      if (streak >= MISSES_BEFORE_HINT && !shown) {
        shown = true;
        deps.report();
      }
    },
    reset(): void {
      streak = 0;
      shown = false;
    }
  };
}
