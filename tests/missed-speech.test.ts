import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeWav } from '../src/voice/wav';
import { MISSED_SPEECH_MIN_MS, isMissedSpeech } from '../src/voice/missed-speech';
import { flush, makeHarness, voice } from './wake-test-helpers';

const RATE = 16000;

// Звук заданной длительности: настоящий WAV, чтобы длительность дошла до правила.
function wavOf(ms: number): Uint8Array {
  return encodeWav(new Float32Array(Math.round((RATE * ms) / 1000)), RATE);
}

const LONG = wavOf(MISSED_SPEECH_MIN_MS + 200);
const SHORT = wavOf(MISSED_SPEECH_MIN_MS - 200);

afterEach(() => {
  vi.useRealTimers();
});

describe('isMissedSpeech: промах или отсеянный шум', () => {
  it('пустой ответ на длинный звук — промах', () => {
    expect(isMissedSpeech({ ok: false, error: 'Не расслышал', empty: true }, MISSED_SPEECH_MIN_MS + 1)).toBe(true);
  });

  it('короткий звук и ненадёжное распознавание — не промах', () => {
    const empty = { ok: false as const, error: 'Не расслышал', empty: true };
    expect(isMissedSpeech(empty, MISSED_SPEECH_MIN_MS)).toBe(false);
    expect(isMissedSpeech({ ok: false, error: 'Не расслышал', unreliable: true }, 5000)).toBe(false);
  });
});

describe('wake-flow: подсказка о калибровке после промахов', () => {
  it('пустой ответ службы на звук длиннее секунды зовёт onMissedSpeech', async () => {
    vi.useFakeTimers();
    const h = makeHarness([{ error: 'Не расслышал', empty: true }], voice({ talkByDefault: true }));
    h.flow.enableConversation();

    h.flow.handlePhrase(LONG);
    await flush();

    expect(h.missed()).toBe(1);
    expect(h.errors).toEqual([]);
    expect(h.captions).toEqual([]);
  });

  it('короткий стук клавиш промахом не считается', async () => {
    vi.useFakeTimers();
    const h = makeHarness([{ error: 'Не расслышал', empty: true }], voice({ talkByDefault: true }));
    h.flow.enableConversation();

    h.flow.handlePhrase(SHORT);
    await flush();

    expect(h.missed()).toBe(0);
    expect(h.errors).toEqual([]);
  });

  it('ненадёжное распознавание промахом не считается', async () => {
    vi.useFakeTimers();
    const h = makeHarness(
      [{ error: 'Не расслышал', unreliable: true }],
      voice({ talkByDefault: true })
    );
    h.flow.enableConversation();

    h.flow.handlePhrase(LONG);
    await flush();

    expect(h.missed()).toBe(0);
    expect(h.captions).toEqual(['не разобрал']);
    expect(h.errors).toEqual([]);
  });
});
