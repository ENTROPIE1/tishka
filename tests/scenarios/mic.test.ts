import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScenario, type Scenario } from './harness';

let scenario: Scenario | undefined;

afterEach(() => {
  scenario?.dispose();
  scenario = undefined;
  vi.useRealTimers();
});

// Сценарий 6 (Д20): щелчок по микрофону выключает и включает разговор,
// значок и запись меняются вместе.
describe('Сценарий 6. Щелчок по микрофону', () => {
  it('выключил → включил → выключил, значок каждый раз соответствует записи', async () => {
    scenario = createScenario({ sttStatus: 'ready', wakeEnabled: false, warmMinutes: 0 });
    const h = scenario;
    h.startApp();
    await h.wait(1000);
    expect(h.observations.micOn()).toBe(true);
    expect(h.observations.recording()).toBe(true);
    expect(h.observations.label()).toBe('слушает');
    // приветствие кончилось: облачко скрыто, запись видна по значку и подписи
    expect(h.observations.bubble()).toBe('');

    h.micClick();
    expect(h.observations.micOn()).toBe(false);
    expect(h.observations.recording()).toBe(false);
    expect(h.observations.commands()).toContain('conversation-off');

    h.micClick();
    expect(h.observations.micOn()).toBe(true);
    expect(h.observations.recording()).toBe(true);

    h.micClick();
    expect(h.observations.micOn()).toBe(false);
    expect(h.observations.recording()).toBe(false);
  });

  it('после выключения щелчком автоматическое включение в том же появлении не происходит', async () => {
    scenario = createScenario({ sttStatus: 'ready' });
    const h = scenario;
    h.startApp();
    await h.wait(1000);
    expect(h.observations.micOn()).toBe(true);

    h.micClick();
    expect(h.observations.micOn()).toBe(false);

    // микрофон продолжает слушать имя, но разговор сам не включается
    expect(h.say('тишка')).toBe(true);
    await h.flush();
    expect(h.observations.micOn()).toBe(false);
    expect(h.observations.recording()).toBe(false);
  });
});

// Сценарий 7 (Д19): печать в строке ставит запись на паузу и не создаёт ошибок.
describe('Сценарий 7. Печать в строке при включённом разговоре', () => {
  it('запись на паузе, ошибок нет, через 2 секунды запись возобновляется', async () => {
    scenario = createScenario({ sttStatus: 'ready' });
    const h = scenario;
    h.startApp();
    await h.wait(1000);
    expect(h.observations.recording()).toBe(true);

    h.typeKey();
    expect(h.observations.recording()).toBe(false);
    expect(h.observations.micOn()).toBe(true);

    expect(h.say('привет')).toBe(false);
    await h.flush();
    expect(h.observations.sttRequests()).toBe(0);
    expect(h.observations.errors()).toEqual([]);
    expect(h.observations.conversationOn()).toBe(true);

    await h.wait(2000);
    expect(h.observations.recording()).toBe(true);
    expect(h.say('тишка')).toBe(true);
    await h.flush();
    expect(h.observations.sttRequests()).toBe(1);
  });
});
