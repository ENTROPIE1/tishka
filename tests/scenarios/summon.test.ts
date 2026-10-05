import { afterEach, describe, expect, it, vi } from 'vitest';
import { SUMMON_REPLY } from '../../src/voice/wake';
import { createScenario, type Scenario } from './harness';

let scenario: Scenario | undefined;

afterEach(() => {
  scenario?.dispose();
  scenario = undefined;
  vi.useRealTimers();
});

// Ёж на экране, разговор по умолчанию выключен: фраза с именем идёт через routeWake.
function visiblePet(): Scenario {
  const h = createScenario({ sttStatus: 'ready', talkByDefault: false });
  h.startApp();
  return h;
}

// Н36: слова вызова не становятся просьбой, лишней записи и «Не расслышал» нет.
describe('Сценарий 20. Слова вызова после имени', () => {
  it('«Тишка, приходи»: ёж появился, в ядро ничего не ушло', async () => {
    scenario = visiblePet();
    const h = scenario;

    expect(h.say('Тишка, приходи')).toBe(true);
    await h.flush();
    expect(h.observations.visible()).toBe(true);
    expect(h.observations.coreCalls()).toEqual([]);
    expect(h.observations.errors()).toEqual([]);
  });

  it('«Тишка, иди сюда, который час»: в ядро ушла только просьба', async () => {
    scenario = visiblePet();
    const h = scenario;

    expect(h.say('Тишка, иди сюда, который час')).toBe(true);
    await h.flush();
    expect(h.observations.coreCalls()).toEqual(['который час']);
    expect(h.observations.errors()).toEqual([]);
  });

  it('«Тишка, какие встречи»: в ядро ушло, отдельной записи нет', async () => {
    scenario = visiblePet();
    const h = scenario;

    expect(h.say('Тишка, какие встречи')).toBe(true);
    await h.flush();
    expect(h.observations.coreCalls()).toEqual(['какие встречи']);
    expect(h.observations.commands()).not.toContain('listen');
    expect(h.observations.errors()).toEqual([]);
  });

  it('«Тишка, ты тут?» в разговоре: готовый ответ без модели', async () => {
    scenario = createScenario({ sttStatus: 'ready' });
    const h = scenario;
    h.startApp();
    await h.wait(1000);
    expect(h.observations.conversationOn()).toBe(true);

    expect(h.say('Тишка, ты тут?')).toBe(true);
    await h.flush();
    expect(h.observations.bubble()).toBe(SUMMON_REPLY);
    expect(h.observations.coreCalls()).toEqual([]);
  });
});
