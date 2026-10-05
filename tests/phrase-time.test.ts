import { describe, expect, it } from 'vitest';
import { createPhraseClock } from '../src/voice/phrase-time';
import type { TimingDetails } from '../src/main/timing-log';

describe('createPhraseClock', () => {
  it('фраза после включения разговора становится репликой', () => {
    const clock = createPhraseClock({ now: () => 0 });
    clock.conversationEnabled(100);
    expect(clock.decide(100)).toEqual({ kind: 'reply' });
    expect(clock.decide(250)).toEqual({ kind: 'reply' });
  });

  it('фраза, начавшаяся до включения разговора, отбрасывается', () => {
    const clock = createPhraseClock({ now: () => 0 });
    clock.conversationEnabled(100);
    expect(clock.decide(99)).toEqual({ kind: 'drop', reason: 'before-conversation' });
  });

  it('фраза, начавшаяся во время ответа Тишки, отбрасывается как during-answer', () => {
    const clock = createPhraseClock({ now: () => 0 });
    clock.conversationEnabled(0);
    clock.busyChanged(true, 100);
    expect(clock.decide(150)).toEqual({ kind: 'drop', reason: 'during-answer' });
  });

  it('фраза после окончания ответа снова реплика', () => {
    const clock = createPhraseClock({ now: () => 0 });
    clock.conversationEnabled(0);
    clock.busyChanged(true, 100);
    clock.busyChanged(false, 200);
    expect(clock.decide(250)).toEqual({ kind: 'reply' });
  });

  it('фраза, начавшаяся до ответа, но услышанная во время — реплика', () => {
    const clock = createPhraseClock({ now: () => 0 });
    clock.conversationEnabled(0);
    clock.busyChanged(true, 100);
    expect(clock.decide(50)).toEqual({ kind: 'reply' });
  });

  it('после выключения разговора сказанное раньше не становится репликой', () => {
    const clock = createPhraseClock({ now: () => 0 });
    clock.conversationEnabled(0);
    clock.conversationDisabled();
    expect(clock.decide(50)).toEqual({ kind: 'drop', reason: 'before-conversation' });
  });

  it('отброшенная фраза отмечается в журнале времени с причиной', () => {
    const events: { event: string; details?: TimingDetails }[] = [];
    const clock = createPhraseClock({
      now: () => 0,
      mark: (event, details) => events.push({ event, details })
    });
    clock.conversationEnabled(100);
    clock.drop('before-conversation');
    expect(events).toEqual([{ event: 'phrase.dropped', details: { reason: 'before-conversation' } }]);
  });
});
