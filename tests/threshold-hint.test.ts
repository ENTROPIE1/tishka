import { describe, expect, it } from 'vitest';
import { createThresholdHint } from '../src/voice/threshold-hint';
import { createWakeFlow } from '../src/voice/wake-flow';
import { createEventBus } from '../src/core/events';
import { voice } from './wake-test-helpers';

const wav = new Uint8Array([1, 2, 3, 4]);

describe('createThresholdHint', () => {
  it('три отрезка подряд без тишины дают одну подсказку', () => {
    let reported = 0;
    const hint = createThresholdHint({ report: () => (reported += 1) });
    hint.limit();
    hint.limit();
    expect(reported).toBe(0);
    hint.limit();
    hint.limit();
    expect(reported).toBe(1);
  });

  it('фраза, закончившаяся сама, прерывает серию', () => {
    let reported = 0;
    const hint = createThresholdHint({ report: () => (reported += 1) });
    hint.limit();
    hint.limit();
    hint.ended();
    hint.limit();
    hint.limit();
    expect(reported).toBe(0);
    hint.limit();
    expect(reported).toBe(1);
  });
});

describe('wake-flow: подсказка поднять порог', () => {
  function mount() {
    const bus = createEventBus();
    const statuses: string[] = [];
    bus.on((event) => {
      if (event.type === 'status') {
        statuses.push(event.text);
      }
    });
    let limitHit = false;
    const flow = createWakeFlow({
      getVoice: () => voice(),
      stt: { transcribe: async () => ({ ok: false, error: 'Не расслышал', empty: true }) },
      core: { handleUserText: async () => ({ say: 'ок' }) },
      bus,
      sendCommand: () => undefined,
      hide: () => undefined,
      onWakeLimit: () => thresholdHint.limit(),
      onWakePhraseEnd: () => thresholdHint.ended()
    });
    const thresholdHint = createThresholdHint({
      report: () => {
        limitHit = true;
        bus.emit({ type: 'status', text: 'Поднимите порог громкости' });
      }
    });
    return { flow, statuses, flag: () => limitHit };
  }

  it('три отрезка с пределом подряд показывают подсказку один раз', () => {
    const h = mount();
    h.flow.handlePhrase(wav, true);
    h.flow.handlePhrase(wav, true);
    expect(h.statuses).toEqual([]);
    h.flow.handlePhrase(wav, true);
    expect(h.statuses).toEqual(['Поднимите порог громкости']);
    h.flow.handlePhrase(wav, true);
    expect(h.statuses).toEqual(['Поднимите порог громкости']);
  });

  it('фраза без предела сбрасывает серию', () => {
    const h = mount();
    h.flow.handlePhrase(wav, true);
    h.flow.handlePhrase(wav, true);
    h.flow.handlePhrase(wav);
    h.flow.handlePhrase(wav, true);
    h.flow.handlePhrase(wav, true);
    expect(h.statuses).toEqual([]);
    h.flow.handlePhrase(wav, true);
    expect(h.flag()).toBe(true);
  });
});
