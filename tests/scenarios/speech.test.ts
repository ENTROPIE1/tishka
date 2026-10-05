import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareForSpeech } from '../../src/voice/speech-text';
import { createScenario, type Scenario } from './harness';

const LONG_REPLY =
  'Первое предложение для проверки озвучки. ' +
  'Второе предложение для проверки озвучки. ' +
  'Третье предложение для проверки озвучки.';

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

// Сценарий 20 (задача 96): длинная реплика озвучивается по частям и начинает
// звучать после синтеза первого предложения, не дожидаясь всего текста.
describe('Сценарий 20. Длинная реплика начинает звучать по частям', () => {
  it('звук начинается после синтеза первого предложения', async () => {
    scenario = createScenario({ sttStatus: 'ready', reply: { say: LONG_REPLY } });
    const h = scenario;
    h.startApp();
    await h.flush();
    // Приветствие отзвучало: дальше считаем только запросы ответа.
    await h.wait(1000);
    const before = h.tts.requests();

    h.tts.delayMs = 1000;
    h.say('расскажи историю');
    await h.flush();
    expect(h.tts.requests()).toBe(before + 1);
    expect(h.observations.spoken()).not.toContain(prepareForSpeech(LONG_REPLY));

    await h.wait(1000);
    expect(h.observations.spoken()).toContain(prepareForSpeech(LONG_REPLY));
    expect(h.tts.requests()).toBe(before + 2);
    expect(h.tts.requests()).toBeLessThan(before + 3);

    await h.wait(3000);
    expect(h.tts.requests()).toBe(before + 3);
  });
});
