import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScenario, type Scenario } from './harness';

let scenario: Scenario | undefined;

afterEach(() => {
  scenario?.dispose();
  scenario = undefined;
  vi.useRealTimers();
});

// Сценарий 18 (задача 99): Whisper на тишине выдумал титры «Субтитры создавал
// DimaTorzok» — в ядро ничего не ушло, разговор продолжается.
describe('Сценарий 18. Выдумка распознавания не уходит в ядро', () => {
  it('выдуманные титры отброшены, следующая настоящая фраза доходит', async () => {
    scenario = createScenario({ sttStatus: 'ready' });
    const h = scenario;
    h.startApp();
    await h.wait(1000);
    expect(h.observations.conversationOn()).toBe(true);
    const spokenBefore = h.observations.spoken().length;

    h.hear('Субтитры создавал DimaTorzok');
    expect(h.say()).toBe(true);
    await h.flush();
    expect(h.observations.coreCalls()).toEqual([]);
    expect(h.observations.conversationOn()).toBe(true);
    expect(h.observations.errors()).toEqual([]);
    expect(h.observations.spoken().length).toBe(spokenBefore);

    h.hear('включи музыку');
    expect(h.say()).toBe(true);
    await h.flush();
    expect(h.observations.coreCalls()).toEqual(['включи музыку']);
    expect(h.observations.conversationOn()).toBe(true);
  });
});
