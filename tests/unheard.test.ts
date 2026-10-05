import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UNHEARD_CAPTION, createUnheardFlow } from '../src/voice/unheard';
import { flush, makeHarness, wav, type PhraseScript } from './wake-test-helpers';

const UNRELIABLE: PhraseScript = { error: 'Не расслышал', unreliable: true };

describe('подсказка про тихую речь', () => {
  it('каждая отброшенная фраза показывает подпись, третья подряд — подсказку', () => {
    const captions: string[] = [];
    const hints: number[] = [];
    const unheard = createUnheardFlow({
      onCaption: (text) => captions.push(text),
      report: () => hints.push(1)
    });
    unheard.dropped();
    unheard.dropped();
    expect(captions).toEqual([UNHEARD_CAPTION, UNHEARD_CAPTION]);
    expect(hints).toEqual([]);
    unheard.dropped();
    expect(hints).toEqual([1]);
    unheard.dropped();
    expect(captions).toHaveLength(4);
    expect(hints).toHaveLength(1);
  });

  it('уверенная речь прерывает серию, подсказка показывается один раз', () => {
    const captions: string[] = [];
    const hints: number[] = [];
    const unheard = createUnheardFlow({ onCaption: (text) => captions.push(text), report: () => hints.push(1) });
    unheard.dropped();
    unheard.dropped();
    unheard.heard();
    unheard.dropped();
    unheard.dropped();
    expect(hints).toEqual([]);
    unheard.dropped();
    expect(hints).toEqual([1]);
    unheard.heard();
    unheard.dropped();
    unheard.dropped();
    unheard.dropped();
    expect(captions).toHaveLength(8);
    expect(hints).toHaveLength(1);
  });
});

describe('wake-flow: неуверенная фраза в разговоре', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('в разговоре подпись показывается, ошибки и речи нет', async () => {
    const h = makeHarness([UNRELIABLE, UNRELIABLE, UNRELIABLE, UNRELIABLE]);
    h.flow.enableConversation();
    for (let i = 0; i < 4; i += 1) {
      h.flow.handlePhrase(wav);
      await flush();
    }
    expect(h.captions).toEqual([UNHEARD_CAPTION, UNHEARD_CAPTION, UNHEARD_CAPTION, UNHEARD_CAPTION]);
    expect(h.hints()).toBe(1);
    expect(h.errors).toEqual([]);
    expect(h.spoken).toEqual([]);
    expect(h.calls).toEqual([]);
    expect(h.flow.isConversation()).toBe(true);
  });

  it('не в разговоре неуверенная фраза остаётся без реакции', async () => {
    const h = makeHarness([UNRELIABLE]);
    h.flow.handlePhrase(wav);
    await flush();
    expect(h.captions).toEqual([]);
    expect(h.hints()).toBe(0);
    expect(h.errors).toEqual([]);
  });

  it('пустой результат не считается неуверенной фразой и не сдвигает серию', async () => {
    const h = makeHarness([
      UNRELIABLE,
      UNRELIABLE,
      { error: 'Не расслышал', empty: true },
      UNRELIABLE,
      UNRELIABLE,
      UNRELIABLE
    ]);
    h.flow.enableConversation();
    for (let i = 0; i < 6; i += 1) {
      h.flow.handlePhrase(wav);
      await flush();
    }
    expect(h.captions).toHaveLength(5);
    expect(h.hints()).toBe(1);
    expect(h.errors).toEqual([]);
  });
});
