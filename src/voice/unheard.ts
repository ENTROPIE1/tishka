export const UNHEARD_CAPTION = 'не разобрал';
export const UNHEARD_HINT =
  'Разбираю тихую речь плохо. Поднимите порог громкости или откалибруйте микрофон в разделе „Голос“';

const DROPS_BEFORE_HINT = 3;

export interface UnheardDeps {
  // Разовая подпись под ежом: текст подписи.
  onCaption(text: string): void;
  // Подсказка про порог и микрофон, один раз за запуск.
  report(): void;
}

export interface UnheardFlow {
  // Отброшенная по уверенности фраза в разговоре.
  dropped(): void;
  // Уверенно распознанная речь: серия прервана.
  heard(): void;
}

// Человек сказал тихо, и распознавание отбросило фразу по уверенности: ёж
// показывает подписью «не разобрал», молча. Три таких фразы подряд — один раз
// подсказка про порог и микрофон. Серию прерывает только уверенно
// распознанная речь: пустота и шум — не попытки сказать.
export function createUnheardFlow(deps: UnheardDeps): UnheardFlow {
  let drops = 0;
  let reported = false;
  return {
    dropped(): void {
      deps.onCaption(UNHEARD_CAPTION);
      drops += 1;
      if (drops >= DROPS_BEFORE_HINT && !reported) {
        reported = true;
        deps.report();
      }
    },
    heard(): void {
      drops = 0;
    }
  };
}
