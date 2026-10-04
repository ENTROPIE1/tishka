// Отсев коротких щелчков: речь считается начавшейся, когда громкий участок
// достаточно плотный (без длинных промежутков) и длится не меньше порога.
// Одиночный щелчок и их серия с паузами порог не набирают, слитная речь — да.
export interface SpeechStart {
  push(loud: boolean, frameMs: number, elapsed: number): boolean;
  started(): boolean;
  startMs(): number;
  reset(): void;
}

const GAP_RESET_MS = 200;
const DENSITY = 0.7;

export function createSpeechStart(minSpeechMs: number): SpeechStart {
  let loudMs = 0;
  let spanMs = 0;
  let gapMs = 0;
  let startMs = 0;
  let started = false;

  function reset(): void {
    loudMs = 0;
    spanMs = 0;
    gapMs = 0;
    startMs = 0;
    started = false;
  }

  function push(loud: boolean, frameMs: number, elapsed: number): boolean {
    if (!started) {
      if (loud) {
        if (spanMs === 0) {
          startMs = elapsed;
        }
        loudMs += frameMs;
        spanMs += frameMs;
        gapMs = 0;
      } else if (spanMs > 0) {
        spanMs += frameMs;
        gapMs += frameMs;
        if (gapMs > GAP_RESET_MS) {
          loudMs = 0;
          spanMs = 0;
          gapMs = 0;
        }
      }
      if (loudMs >= minSpeechMs && loudMs >= spanMs * DENSITY) {
        started = true;
      }
    }
    return started;
  }

  return { push, started: () => started, startMs: () => startMs, reset };
}
