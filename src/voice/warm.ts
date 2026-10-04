export const DEFAULT_WARM_MINUTES = 30;

export interface WarmInput {
  ready: boolean;                 // служба распознавания готова
  wakeEnabled: boolean;           // отклик на имя: микрофон слушает постоянно
  ownerActive: boolean;           // идёт разговор в этом окне
  lastInteractionAt: number;      // мс последнего обращения
  now: number;                    // текущее время, мс
  warmMinutes: number;
}

// Микрофон держится открытым, пока идёт разговор, включён отклик на имя или
// с последнего обращения прошло меньше warmMinutes. Иначе — холодный старт.
export function keepMicOpen(input: WarmInput): boolean {
  if (!input.ready) {
    return false;
  }
  if (input.ownerActive || input.wakeEnabled) {
    return true;
  }
  const warmMs = Math.max(0, input.warmMinutes) * 60000;
  return input.now - input.lastInteractionAt < warmMs;
}
