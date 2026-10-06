import type { TranscribeResult } from './stt-service';

// Отсеянный шум (стук клавиш, знаки, ненадёжное распознавание) промахом не
// считается: человек в этот момент не пытался сказать. Пустой ответ службы на
// звук длиннее этого срока — попытка сказать, но распознавание не разобрало:
// промах, повод для подсказки о калибровке. Человеку при этом ничего не видно.
export const MISSED_SPEECH_MIN_MS = 1000;

export function isMissedSpeech(result: TranscribeResult, speechMs: number): boolean {
  // Отброшенная выдумка распознавания — не попытка сказать: подсказка не нужна.
  if (result.ok === false && result.hallucination === true) {
    return false;
  }
  return result.ok === false && result.empty === true && speechMs > MISSED_SPEECH_MIN_MS;
}
