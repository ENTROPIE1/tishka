import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createScriptPlayer,
  missingClips,
  scriptSteps,
  speechLevel
} from '../src/renderer/stand/stand-logic';

afterEach(() => {
  vi.useRealTimers();
});

describe('scriptSteps', () => {
  it('отдаёт шаги сценария в описанном порядке', () => {
    expect(scriptSteps().map((step) => step.state)).toEqual([
      'appear',
      'idle',
      'listening',
      'thinking',
      'working',
      'talking',
      'happy',
      'idle',
      'leave'
    ]);
  });
});

describe('createScriptPlayer', () => {
  it('проигрывает шаги по порядку, «Стоп» прерывает', () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    let finished = false;
    const player = createScriptPlayer({
      steps: scriptSteps(),
      onStep: (step) => seen.push(step.state),
      onFinish: () => {
        finished = true;
      }
    });

    player.start();
    expect(seen).toEqual(['appear']);

    vi.advanceTimersByTime(2000 * 3);
    expect(seen).toEqual(['appear', 'idle', 'listening', 'thinking']);
    expect(player.isRunning()).toBe(true);

    player.stop();
    vi.advanceTimersByTime(2000 * 20);
    expect(seen).toEqual(['appear', 'idle', 'listening', 'thinking']);
    expect(finished).toBe(false);
    expect(player.isRunning()).toBe(false);
  });

  it('доходит до конца и сообщает о завершении', () => {
    vi.useFakeTimers();
    let finished = false;
    const player = createScriptPlayer({
      steps: scriptSteps(),
      onStep: () => undefined,
      onFinish: () => {
        finished = true;
      }
    });

    player.start();
    vi.advanceTimersByTime(2000 * scriptSteps().length);
    expect(finished).toBe(true);
    expect(player.isRunning()).toBe(false);
  });
});

describe('missingClips', () => {
  it('персонаж без walk просит walk', () => {
    expect(missingClips(['idle', 'listen', 'talk'])).toEqual(['walk']);
  });

  it('полный набор не даёт недостающих', () => {
    expect(missingClips(['idle', 'walk', 'listen', 'talk', 'happy'])).toEqual([]);
  });
});

describe('speechLevel', () => {
  it('всегда в диапазоне 0–1', () => {
    for (let i = 0; i < 500; i += 1) {
      const level = speechLevel(i * 37, () => Math.random());
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(1);
    }
  });

  it('при крайнем шуме не выходит из диапазона', () => {
    expect(speechLevel(0, () => 0)).toBeGreaterThanOrEqual(0);
    expect(speechLevel(1234, () => 1)).toBeLessThanOrEqual(1);
  });
});
