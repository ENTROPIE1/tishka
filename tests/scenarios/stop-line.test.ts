import { afterEach, describe, expect, it, vi } from 'vitest';
import { STOPPED_TITLE } from '../../src/core/stopped';
import { createScenario, type Scenario } from './harness';

let scenario: Scenario | undefined;

afterEach(() => {
  scenario?.dispose();
  scenario = undefined;
  vi.useRealTimers();
});

// Сценарий 14 (задача 85, уточнён задачей 94): остановка из окна чата показывает
// служебную строку «Остановлено» только в ленте чата. Ядро шлёт её событием
// статуса из хода, запущенного в окне чата; ёж такой статус не показывает:
// скрытый ёж не появляется, видимый не выводит строку в облачко.
describe('Сценарий 14. Остановка из окна чата', () => {
  it('скрытый ёж не поднимается', async () => {
    scenario = createScenario({ sttStatus: 'ready', talkTimeoutSec: 3 });
    const h = scenario;
    h.startApp();
    await h.wait(4000);
    expect(h.observations.visible()).toBe(false);

    h.stopFromChat();
    await h.wait(1000);
    await h.flush();
    expect(h.observations.visible()).toBe(false);
    expect(h.observations.state()).toBe('hidden');
  });

  it('видимый ёж не выводит «Остановлено» в облачко', async () => {
    scenario = createScenario({ sttStatus: 'ready', talkByDefault: false });
    const h = scenario;
    h.startApp();
    await h.wait(1000);
    expect(h.observations.visible()).toBe(true);

    h.stopFromChat();
    await h.wait(1000);
    await h.flush();
    expect(h.observations.visible()).toBe(true);
    expect(h.observations.state()).not.toBe('notify');
    expect(h.observations.modelSay()).not.toBe(STOPPED_TITLE);
    expect(h.observations.bubble()).not.toContain(STOPPED_TITLE);
  });
});
