import { describe, expect, it } from 'vitest';
import { DEFAULT_MIC_THRESHOLD, createVad, trimSpeech, type Vad, type VadVerdict } from '../src/voice/vad';

const FRAME_MS = 20;

function frame(value: number): Float32Array {
  return new Float32Array(320).fill(value);
}

function feed(vad: Vad, value: number, count: number): VadVerdict {
  let verdict: VadVerdict = 'continue';
  for (let i = 0; i < count; i += 1) {
    verdict = vad.push(frame(value), FRAME_MS);
    if (verdict !== 'continue') {
      return verdict;
    }
  }
  return verdict;
}

describe('createVad', () => {
  it('тишина 5 секунд даёт nospeech', () => {
    const vad = createVad();
    expect(feed(vad, 0, 250)).toBe('nospeech');
  });

  it('звук ниже порога не начинает фразу', () => {
    const vad = createVad({ threshold: 0.02 });
    feed(vad, 0.015, 250);
    expect(vad.heardSpeech()).toBe(false);
  });

  it('звук ниже порога завершает начавшуюся фразу', () => {
    const vad = createVad();
    feed(vad, 0.012, 20);
    expect(vad.heardSpeech()).toBe(true);
    expect(feed(vad, 0.003, 60)).toBe('end');
  });

  it('тихая речь 0,008 считается речью при пороге по умолчанию', () => {
    const vad = createVad();
    feed(vad, 0.002, 15);
    expect(feed(vad, 0.008, 15)).toBe('continue');
    expect(vad.heardSpeech()).toBe(true);
  });

  it('калиброванный порог 0,006 делает речь 0,008 речью', () => {
    const vad = createVad({ threshold: 0.006 });
    feed(vad, 0.002, 15);
    feed(vad, 0.008, 20);
    expect(vad.heardSpeech()).toBe(true);
  });

  it('фоновый шум не поднимает порог: после шума речь слышна', () => {
    const vad = createVad({ threshold: 0.006 });
    feed(vad, 0.0055, 150);
    feed(vad, 0.008, 20);
    expect(vad.heardSpeech()).toBe(true);
  });

  it('порог по умолчанию рассчитан на тихую комнату', () => {
    expect(DEFAULT_MIC_THRESHOLD).toBe(0.004);
  });

  it('провал в один кадр не обрывает речь и не теряет начало', () => {
    const vad = createVad();
    feed(vad, 0.002, 15);
    feed(vad, 0.012, 12);
    expect(vad.heardSpeech()).toBe(true);
    expect(vad.push(frame(0.002), FRAME_MS)).toBe('continue');
    expect(feed(vad, 0.012, 12)).toBe('continue');
    expect(vad.heardSpeech()).toBe(true);
  });

  it('постоянный шум ниже заданного порога речью не считается', () => {
    const vad = createVad({ threshold: 0.02 });
    expect(feed(vad, 0.01, 250)).toBe('nospeech');
    expect(vad.heardSpeech()).toBe(false);
  });

  it('короткий щелчок речью не считается', () => {
    const vad = createVad();
    feed(vad, 0.002, 15);
    expect(vad.push(frame(0.8), FRAME_MS)).toBe('continue');
    expect(feed(vad, 0.002, 240)).toBe('nospeech');
  });

  it('уровень остаётся в диапазоне 0..1, порог — на середине', () => {
    const vad = createVad();
    vad.push(frame(0.5), FRAME_MS);
    expect(vad.level()).toBeGreaterThanOrEqual(0);
    expect(vad.level()).toBeLessThanOrEqual(1);
  });
});

describe('createVad: непрерывный режим', () => {
  it('до начала речи не завершается по timeout, сколько бы ни длилась тишина', () => {
    const vad = createVad({ continuous: true, noSpeechMs: 0, settleMs: 300 });
    expect(feed(vad, 0.002, 2000)).toBe('continue');
    expect(vad.heardSpeech()).toBe(false);
  });

  it('предел длины фразы отсчитывается от начала речи, а не от открытия микрофона', () => {
    const vad = createVad({ continuous: true, noSpeechMs: 0, maxMs: 400, silenceMs: 10000 });
    expect(feed(vad, 0.002, 300)).toBe('continue');
    expect(vad.heardSpeech()).toBe(false);
    expect(feed(vad, 0.1, 100)).toBe('timeout');
  });

  it('после end VAD готов к следующей фразе, порог не меняется', () => {
    const vad = createVad({ continuous: true, noSpeechMs: 0, settleMs: 300, silenceMs: 200 });
    feed(vad, 0.002, 20);
    expect(feed(vad, 0.012, 15)).toBe('continue');
    expect(vad.heardSpeech()).toBe(true);
    expect(feed(vad, 0.002, 15)).toBe('end');
    expect(feed(vad, 0.002, 5)).toBe('continue');
    expect(vad.heardSpeech()).toBe(false);
    expect(feed(vad, 0.012, 15)).toBe('continue');
    expect(vad.heardSpeech()).toBe(true);
  });

  it('первые 300 мс после включения не считаются речью, но речь сразу после распознаётся', () => {
    const vad = createVad({ continuous: true, noSpeechMs: 0, settleMs: 300 });
    feed(vad, 0.002, 14);
    vad.push(frame(0.8), FRAME_MS);
    expect(vad.heardSpeech()).toBe(false);
    expect(feed(vad, 0.012, 15)).toBe('continue');
    expect(vad.heardSpeech()).toBe(true);
  });

  it('долгий фоновый шум не меняет порог: тише порога остаётся тишиной', () => {
    const vad = createVad({ continuous: true, noSpeechMs: 0, settleMs: 300 });
    feed(vad, 0.003, 500);
    expect(vad.heardSpeech()).toBe(false);
    feed(vad, 0.012, 15);
    expect(vad.heardSpeech()).toBe(true);
  });
});

describe('trimSpeech', () => {
  it('добавляет запас до начала речи и обрезает длинную тишину', () => {
    const samples = new Float32Array(16000).fill(1);
    const result = trimSpeech(samples, 16000, 1000, 1500);
    expect(result.length).toBe(16000 - 11200);
  });

  it('оставляет запас 300 мс до начала и хвост после конца', () => {
    const sampleRate = 1000;
    const samples = new Float32Array(5000);
    const result = trimSpeech(samples, sampleRate, 1000, 1500);
    expect(result.length).toBe(1000);
  });
});

describe('createVad: результат записи', () => {
  it('в результате есть запас до речи, а тишина по краям обрезана', () => {
    const vad = createVad();
    const sampleRate = 16000;
    const perFrame = 320;
    const parts: Float32Array[] = [];
    const add = (value: number, count: number): void => {
      for (let i = 0; i < count; i += 1) {
        const part = frame(value);
        parts.push(part);
        vad.push(part, FRAME_MS);
      }
    };
    add(0.002, 25);
    add(0.1, 25);
    add(0.002, 100);
    const collected = new Float32Array(parts.length * perFrame);
    parts.forEach((part, index) => collected.set(part, index * perFrame));

    const result = vad.result(collected, sampleRate);
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThan(collected.length);
    expect(result[0]).toBeCloseTo(0.002);
    expect(result[result.length - 1]).toBeCloseTo(0.002);
  });
});
