// Разговор — подряд идущие реплики человека и Тишки. Отсчёт тишины ведут только
// реплики человека: то, что Тишка говорит сам, разговор не начинает и не продлевает.
export const CONVERSATION_GAP_MS = 30 * 60 * 1000;

export interface ConversationClock {
  start(at: Date): void;          // новый разговор начинается сейчас
  userTurn(at: Date): boolean;    // true — эта реплика человека открывает новый разговор
}

export function createConversationClock(gapMs: number = CONVERSATION_GAP_MS): ConversationClock {
  let lastUserAt: number | null = null;

  return {
    start(at: Date): void {
      lastUserAt = at.getTime();
    },
    userTurn(at: Date): boolean {
      const isNew = lastUserAt === null || at.getTime() - lastUserAt > gapMs;
      lastUserAt = at.getTime();
      return isNew;
    }
  };
}
