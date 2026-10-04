import { describe, expect, it } from 'vitest';
import { createConversationClock, CONVERSATION_GAP_MS } from '../src/core/conversation';

const base = new Date('2026-10-02T10:00:00');

function at(minutes: number): Date {
  return new Date(base.getTime() + minutes * 60_000);
}

describe('createConversationClock', () => {
  it('первая реплика человека начинает новый разговор', () => {
    const clock = createConversationClock();
    expect(clock.userTurn(base)).toBe(true);
  });

  it('реплика в пределах 30 минут продолжает разговор', () => {
    const clock = createConversationClock();
    clock.start(base);
    expect(clock.userTurn(at(10))).toBe(false);
  });

  it('после 30 минут тишины начинается новый разговор', () => {
    const clock = createConversationClock();
    clock.start(base);
    expect(clock.userTurn(at(31))).toBe(true);
  });

  it('start начинает разговор заново', () => {
    const clock = createConversationClock(CONVERSATION_GAP_MS);
    clock.userTurn(base);
    clock.start(at(5));
    expect(clock.userTurn(at(10))).toBe(false);
  });
});
