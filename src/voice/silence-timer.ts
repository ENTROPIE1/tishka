const SOON_MS = 5000;

export interface SilenceTimerDeps {
  totalMs(): number;      // полный срок тишины разговора
  fire(): void;           // срок вышел: разговор закрывается
  onSoonChange(): void;   // изменился признак «скоро уйду»
}

export interface SilenceTimer {
  arm(): void;            // полный срок заново
  clear(): void;
  // Распознавание фразы идёт: отсчёт стоит, срок сохраняется.
  pause(): void;
  // Пустой результат распознавания: отсчёт продолжается с места остановки.
  resume(): void;
  soon(): boolean;
}

type State = 'idle' | 'counting' | 'paused';

// Таймер тишины разговора с паузой: пока распознаётся сказанная фраза, отсчёт
// стоит; после пустого результата отсчёт продолжается с места остановки,
// после речи заводится заново. Перед уходом значок мигает «скоро уйду».
export function createSilenceTimer(deps: SilenceTimerDeps): SilenceTimer {
  let state: State = 'idle';
  let soon = false;
  let remainingMs = 0;
  let fireAt = 0;
  let soonTimer: ReturnType<typeof setTimeout> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function setSoon(value: boolean): void {
    if (soon === value) {
      return;
    }
    soon = value;
    deps.onSoonChange();
  }

  function stopTimers(): void {
    if (soonTimer !== undefined) {
      clearTimeout(soonTimer);
      soonTimer = undefined;
    }
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  function schedule(remaining: number): void {
    state = 'counting';
    fireAt = Date.now() + remaining;
    if (remaining > SOON_MS) {
      soonTimer = setTimeout(() => setSoon(true), remaining - SOON_MS);
    } else {
      setSoon(true);
    }
    timer = setTimeout(() => {
      state = 'idle';
      deps.fire();
    }, remaining);
  }

  return {
    arm(): void {
      stopTimers();
      setSoon(false);
      schedule(deps.totalMs());
    },
    clear(): void {
      stopTimers();
      setSoon(false);
      state = 'idle';
    },
    pause(): void {
      if (state !== 'counting') {
        return;
      }
      remainingMs = Math.max(0, fireAt - Date.now());
      stopTimers();
      state = 'paused';
    },
    resume(): void {
      if (state !== 'paused') {
        return;
      }
      schedule(remainingMs);
    },
    soon: () => soon
  };
}
