import { afterEach, describe, expect, it } from 'vitest';
import { createScenario, type Scenario } from './harness';

let scenario: Scenario | undefined;

afterEach(() => {
  scenario?.dispose();
  scenario = undefined;
});

// Сценарий 14 (Д25, задача 86): сказанное при выключенном разговоре приходит
// разом после включения — теперь после включения не приходит вовсе.
describe('Сценарий 14. Сказанное при выключенном разговоре', () => {
  it('после включения разговора старые фразы не доходят до ядра, новая доходит', async () => {
    scenario = createScenario({ sttStatus: 'ready', talkByDefault: false });
    const h = scenario;
    h.startApp();
    // Приветствие «Слушаю» озвучивается: запись открывается после него.
    await h.wait(1000);
    expect(h.observations.conversationOn()).toBe(false);
    expect(h.observations.recording()).toBe(true);

    // Две фразы при выключенном разговоре: первая ушла на распознавание,
    // вторая ждёт очереди.
    expect(h.say('какие встречи сегодня')).toBe(true);
    expect(h.noise()).toBe(true);

    // Включение разговора щелчком: ждущая фраза отбрасывается,
    // идущее распознавание устарело.
    h.micClick();
    expect(h.observations.conversationOn()).toBe(true);

    await h.flush();
    expect(h.observations.coreCalls()).toEqual([]);
    expect(h.observations.sttRequests()).toBe(1);

    // Следующая фраза после включения — обычная реплика разговора.
    expect(h.say('ну покажи встречи')).toBe(true);
    await h.flush();
    expect(h.observations.coreCalls()).toEqual(['ну покажи встречи']);
  });
});
