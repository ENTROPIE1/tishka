import { describe, expect, it } from 'vitest';
import { createSlowSttHint } from '../src/voice/slow-stt-hint';

describe('createSlowSttHint', () => {
  it('три медленных распознавания подряд дают одну подсказку', () => {
    let reported = 0;
    const hint = createSlowSttHint({ report: () => (reported += 1) });
    hint.slow();
    hint.slow();
    expect(reported).toBe(0);
    expect(hint.active()).toBe(false);
    hint.slow();
    expect(reported).toBe(1);
    expect(hint.active()).toBe(true);
    hint.slow();
    expect(reported).toBe(1);
  });

  it('быстрое распознавание гасит подсказку и прерывает серию', () => {
    let reported = 0;
    const hint = createSlowSttHint({ report: () => (reported += 1) });
    hint.slow();
    hint.slow();
    hint.slow();
    expect(hint.active()).toBe(true);

    hint.fast();
    expect(hint.active()).toBe(false);

    hint.slow();
    hint.slow();
    expect(reported).toBe(1);
    hint.slow();
    expect(reported).toBe(2);
  });
});
