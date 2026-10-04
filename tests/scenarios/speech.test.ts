import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScenario, type Scenario } from './harness';

let scenario: Scenario | undefined;

afterEach(() => {
  scenario?.dispose();
  scenario = undefined;
  vi.useRealTimers();
});

// Сценарий 11 (Д18): сбой синтеза не глушит речь и не теряет реплики.
describe('Сценарий 11. Сбой синтеза на одной реплике', () => {
  it('отказ на тексте: реплика показана текстом, следующая звучит', async () => {
    scenario = createScenario({ sttStatus: 'ready', talkTimeoutSec: 300, tts: 'rejected' });
    const h = scenario;
    h.startApp();
    await h.flush();
    expect(h.observations.spoken()).toEqual([]);
    expect(h.observations.errors()).toEqual([]);

    h.say('как дела');
    await h.flush();
    expect(h.observations.bubble()).toBe('Готово');
    expect(h.observations.spoken()).not.toContain('Готово');
    expect(h.observations.errors()).toEqual([]);

    h.tts.mode = 'ok';
    h.say('а теперь голосом');
    await h.flush();
    expect(h.observations.spoken()).toContain('Готово');
    expect(h.observations.errors()).toEqual([]);
  });

  it('недоступная служба: одно сообщение, восстановление без действий человека', async () => {
    scenario = createScenario({ sttStatus: 'ready', talkTimeoutSec: 300, tts: 'unreachable' });
    const h = scenario;
    h.startApp();
    await h.flush();
    expect(h.observations.errors()).toEqual(['Голос недоступен, говорю текстом']);
    const requestsAtStart = h.tts.requests();

    h.say('раз');
    await h.flush();
    expect(h.observations.errors()).toHaveLength(1);
    expect(h.tts.requests()).toBe(requestsAtStart);

    await h.wait(10000);
    h.say('два');
    await h.flush();
    expect(h.observations.errors()).toHaveLength(1);
    expect(h.tts.requests()).toBe(requestsAtStart);

    await h.wait(10000);
    h.tts.mode = 'ok';
    h.say('три');
    await h.flush();
    expect(h.observations.spoken()).toContain('Готово');
    expect(h.observations.errors()).toHaveLength(1);
  });
});
