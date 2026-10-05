import { afterEach, describe, expect, it, vi } from 'vitest';
import { UNHEARD_CAPTION, UNHEARD_HINT } from '../../src/voice/unheard';
import { createScenario, type Scenario } from './harness';

let scenario: Scenario | undefined;

afterEach(() => {
  scenario?.dispose();
  scenario = undefined;
  vi.useRealTimers();
});

// Сценарий 16 (задача 88): тихая фраза, отброшенная по уверенности, молча
// показывается подписью «не разобрал»; три подряд — одна подсказка.
describe('Сценарий 16. Тихая фраза, отброшенная по уверенности', () => {
  it('подпись «не разобрал» под ежом на 2 секунды, без облачка, речи и ошибок', async () => {
    scenario = createScenario({ sttStatus: 'ready' });
    const h = scenario;
    h.startApp();
    await h.wait(1000);
    expect(h.observations.label()).toBe('слушает');
    const spokenBefore = h.observations.spoken().length;

    h.hear({ ok: false, error: 'Не расслышал', unreliable: true });
    expect(h.say()).toBe(true);
    await h.flush();
    expect(h.observations.label()).toBe(UNHEARD_CAPTION);
    expect(h.observations.bubble()).toBe('');
    expect(h.observations.spoken().length).toBe(spokenBefore);
    expect(h.observations.errors()).toEqual([]);
    expect(h.observations.coreCalls()).toEqual([]);
    expect(h.observations.conversationOn()).toBe(true);

    await h.wait(2000);
    expect(h.observations.label()).toBe('слушает');
  });

  it('три тихие фразы подряд — один раз подсказка про порог и микрофон', async () => {
    scenario = createScenario({ sttStatus: 'ready' });
    const h = scenario;
    h.startApp();
    await h.wait(1000);
    const spokenBefore = h.observations.spoken().length;

    h.hear({ ok: false, error: 'Не расслышал', unreliable: true });
    h.say();
    await h.flush();
    h.hear({ ok: false, error: 'Не расслышал', unreliable: true });
    h.say();
    await h.flush();
    expect(h.observations.statuses()).toEqual([]);
    expect(h.observations.spoken().length).toBe(spokenBefore);
    expect(h.observations.errors()).toEqual([]);

    h.hear({ ok: false, error: 'Не расслышал', unreliable: true });
    h.say();
    await h.flush();
    expect(h.observations.statuses()).toEqual([UNHEARD_HINT]);
    expect(h.observations.spoken().length).toBe(spokenBefore);
    expect(h.observations.errors()).toEqual([]);

    h.hear({ ok: false, error: 'Не расслышал', unreliable: true });
    h.say();
    await h.flush();
    // Подсказка показана один раз, четвёртая фраза её не повторяет.
    expect(h.observations.statuses()).toEqual([UNHEARD_HINT]);

    // Уверенно распознанная речь прерывает серию, но подсказка уже была.
    h.hear('ну хорошо');
    h.say();
    await h.flush();
    h.hear({ ok: false, error: 'Не расслышал', unreliable: true });
    h.say();
    await h.flush();
    expect(h.observations.statuses()).toEqual([UNHEARD_HINT]);
    expect(h.observations.coreCalls()).toEqual(['ну хорошо']);
  });
});
