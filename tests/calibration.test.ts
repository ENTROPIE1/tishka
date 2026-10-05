import { describe, expect, it } from 'vitest';
import { computeThreshold, measureNoise, measureSpeech, type CalibrationQuality } from '../src/voice/calibration';
import { createVad, type Vad } from '../src/voice/vad';
import { createCalibrationFlow, NO_SPEECH_MESSAGE, type CalibrationState } from '../src/renderer/settings/calibration-flow';
import { createCalibrationHint } from '../src/voice/calibration-hint';
import type { TranscribeResult } from '../src/voice/stt-service';

const FRAME_MS = 20;
const SAMPLE_RATE = 16000;
const FRAME_SAMPLES = (SAMPLE_RATE * FRAME_MS) / 1000;

function frame(value: number, length = FRAME_SAMPLES): Float32Array {
  return new Float32Array(length).fill(value);
}

function feed(vad: Vad, value: number, count: number): void {
  for (let i = 0; i < count; i += 1) {
    vad.push(frame(value), FRAME_MS);
  }
}

describe('measureNoise и computeThreshold', () => {  it('шум 0,002 (пики 0,003) и речь 0,03 дают good и порог между ними', () => {
    const noiseLevels = [...Array(90).fill(0.002), ...Array(10).fill(0.003)];
    const noise = measureNoise(noiseLevels);
    expect(noise.noise).toBeCloseTo(0.002, 5);
    expect(noise.peak).toBeCloseTo(0.003, 5);
    const speech = measureSpeech([...Array(30).fill(0.03)], noise.peak);
    expect(speech.loudFrames).toBe(30);
    const result = computeThreshold(noise.peak, speech.speech, speech.loudFrames);
    expect(result.quality).toBe<CalibrationQuality>('good');
    expect(result.threshold).toBeGreaterThan(noise.peak);
    expect(result.threshold).toBeLessThan(speech.speech);
  });
  it('шум 0,01 и речь 0,03 дают weak, порог между шумом и речью', () => {
    const result = computeThreshold(0.01, 0.03, 30);
    expect(result.quality).toBe<CalibrationQuality>('weak');
    expect(result.threshold).toBeGreaterThanOrEqual(0.01 * 1.5);
    expect(result.threshold).toBeLessThanOrEqual(0.03 * 0.7);
  });
  it('шум 0,02 и речь 0,03 дают bad', () => {
    expect(computeThreshold(0.02, 0.03, 30).quality).toBe<CalibrationQuality>('bad');
  });
  it('тихие кадры вместо речи дают bad', () => {
    const speech = measureSpeech([...Array(50).fill(0.001)], 0.003);
    expect(speech.loudFrames).toBe(0);
    expect(computeThreshold(0.003, speech.speech, speech.loudFrames).quality).toBe<CalibrationQuality>('bad');
  });
});

describe('createVad: калиброванный порог', () => {
  it('порог 0,006 делает речь 0,008 речью', () => {
    const vad = createVad({ threshold: 0.006 });
    feed(vad, 0.002, 15);
    feed(vad, 0.008, 20);
    expect(vad.heardSpeech()).toBe(true);
  });
  it('выросший фон не поднимает порог: звук громче порога считается речью', () => {
    const vad = createVad({ threshold: 0.006 });
    feed(vad, 0.01, 80);
    expect(vad.heardSpeech()).toBe(true);
  });
});

interface FakeMic {
  mic: { start(onFrame: (frame: Float32Array, rate: number) => void): Promise<boolean>; stop(): void };
  push(value: number, count: number): void;
}

interface Harness {
  mic: FakeMic;
  flow: ReturnType<typeof createCalibrationFlow>;
  updates: CalibrationState[];
  saved: Array<{ threshold: number | null }>;
  pauses: boolean[];
}

function harness(transcribeText = 'тишка какие у меня сегодня встречи'): Harness {
  let handler: ((frame: Float32Array, rate: number) => void) | undefined;
  let time = 1_700_000_000_000;
  const updates: CalibrationState[] = [];
  const saved: Array<{ threshold: number | null }> = [];
  const pauses: boolean[] = [];
  const mic: FakeMic = {
    mic: {
      async start(onFrame): Promise<boolean> {
        handler = onFrame;
        return true;
      },
      stop(): void {
        handler = undefined;
      }
    },
    push(value, count): void {
      for (let i = 0; i < count; i += 1) {
        handler?.(frame(value), SAMPLE_RATE);
        time += FRAME_MS;
      }
    }
  };
  const flow = createCalibrationFlow({
    mic: mic.mic,
    now: () => time,
    transcribe: async (): Promise<TranscribeResult> => ({ ok: true, text: transcribeText }),
    save: async (value) => void saved.push({ threshold: value.threshold }),
    onPause: () => void pauses.push(true),
    onResume: () => void pauses.push(false),
    onUpdate: (state) => void updates.push(state)
  });
  return { mic, flow, updates, saved, pauses };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve();
  }
}

describe('createCalibrationFlow', () => {  it('проходит шаги тишина → речь → итог по порядку', async () => {
    const h = harness();
    await h.flow.start();
    h.mic.push(0.002, 160);
    h.mic.push(0.03, 10);
    h.mic.push(0.002, 80);
    await flush();
    const steps = h.updates.map((state) => state.step);
    expect(steps).toContain('noise');
    expect(steps).toContain('speech');
    expect(steps[steps.length - 1]).toBe('result');
    expect(h.updates[h.updates.length - 1].outcome?.quality).toBe('good');
  });
  it('«Сохранить» пишет калибровку в настройки', async () => {
    const h = harness();
    await h.flow.start();
    h.mic.push(0.002, 160);
    h.mic.push(0.03, 10);
    h.mic.push(0.002, 80);
    await flush();
    await h.flow.save();
    expect(h.saved).toHaveLength(1);
    expect(h.saved[0].threshold).not.toBeNull();
    expect(h.pauses).toEqual([true, false]);
  });
  it('bad не сохраняет и предлагает повторить (речь не услышана)', async () => {
    const h = harness();
    await h.flow.start();
    h.mic.push(0.002, 160);
    h.mic.push(0.002, 420);
    await flush();
    const last = h.updates[h.updates.length - 1];
    expect(last.step).toBe('result');
    expect(last.outcome?.quality).toBe('bad');
    expect(last.outcome?.message).toBe(NO_SPEECH_MESSAGE);
    await h.flow.save();
    expect(h.saved).toHaveLength(0);
  });
  it('«Отмена» ничего не меняет и возобновляет прослушивание', async () => {
    const h = harness();
    await h.flow.start();
    h.mic.push(0.002, 20);
    h.flow.cancel();
    expect(h.saved).toHaveLength(0);
    expect(h.pauses).toEqual([true, false]);
    expect(h.flow.isActive()).toBe(false);
  });
  it('пустой распознанный текст не даёт лучше weak', async () => {
    const h = harness('');
    await h.flow.start();
    h.mic.push(0.002, 160);
    h.mic.push(0.03, 10);
    h.mic.push(0.002, 80);
    await flush();
    expect(h.updates[h.updates.length - 1].outcome?.quality).toBe('weak');
  });
});

describe('createCalibrationHint', () => {  it('три «Не расслышал» подряд без калибровки дают одно сообщение', () => {
    let reported = 0;
    const hint = createCalibrationHint({ isCalibrated: () => false, report: () => (reported += 1) });
    hint.missed();
    hint.missed();
    expect(reported).toBe(0);
    hint.missed();
    hint.missed();
    expect(reported).toBe(1);
  });
  it('с калибровкой подсказка не выводится', () => {
    let reported = 0;
    const hint = createCalibrationHint({ isCalibrated: () => true, report: () => (reported += 1) });
    hint.missed();
    hint.missed();
    hint.missed();
    expect(reported).toBe(0);
  });
});
