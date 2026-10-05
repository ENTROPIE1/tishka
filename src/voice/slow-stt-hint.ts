export const SLOW_STT_HINT =
  'Распознавание на этом компьютере медленное. Подключите готовую службу распознавания';

const SLOW_BEFORE_HINT = 3;

export interface SlowSttHintDeps {
  // Подсказка стала видна: строка в облачке и журнале настроек.
  report(): void;
}

export interface SlowSttHint {
  // Распознавание отрезка длилось дольше самого отрезка.
  slow(): void;
  // Распознавание уложилось в отрезок: серия медленных прервана, подсказка гаснет.
  fast(): void;
  // Подсказка показывается прямо сейчас.
  active(): boolean;
  reset(): void;
}

// Три распознавания подряд дольше отрезка — местная служба не успевает за речью.
// Подсказка предлагает подключить готовую службу; после быстрого распознавания гаснет.
export function createSlowSttHint(deps: SlowSttHintDeps): SlowSttHint {
  let streak = 0;
  let shown = false;
  return {
    slow(): void {
      streak += 1;
      if (streak >= SLOW_BEFORE_HINT && !shown) {
        shown = true;
        deps.report();
      }
    },
    fast(): void {
      streak = 0;
      shown = false;
    },
    active: () => shown,
    reset(): void {
      streak = 0;
      shown = false;
    }
  };
}
