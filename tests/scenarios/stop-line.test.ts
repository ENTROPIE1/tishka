import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScenario, type Scenario } from './harness';

let scenario: Scenario | undefined;

afterEach(() => {
  scenario?.dispose();
  scenario = undefined;
  vi.useRealTimers();
});

// Сценарий 14 (задача 85): остановка из окна чата показывает служебную строку
// «Остановлено» только в ленте чата. Ядро шлёт её событием статуса, которое ёж
// не показывает: скрытый ёж не появляется, видимого состояние не меняет.
describe('Сценарий 14. Остановка из окна чата', () => {
  it('скрытый ёж не поднимается', async () => {
    scenario = createScenario({ sttStatus: 'ready', talkTimeoutSec: 3 });
    const h = scenario;
    h.startApp();
    await h.wait(4000);
    expect(h.observations.visible()).toBe(false);

    h.stopFromChat();
    await h.flush();
    expect(h.observations.visible()).toBe(false);
    expect(h.observations.state()).toBe('hidden');
  });

  it('видимый ёж не переходит в уведомление', async () => {
    scenario = createScenario({ sttStatus: 'ready', talkByDefault: false });
    const h = scenario;
    h.startApp();
    await h.wait(1000);
    expect(h.observations.visible()).toBe(true);

    h.stopFromChat();
    await h.flush();
    expect(h.observations.visible()).toBe(true);
    expect(h.observations.state()).not.toBe('notify');
  });
});
