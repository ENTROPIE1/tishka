import { afterEach, describe, expect, it, vi } from 'vitest';
import { CANNED } from '../../src/voice/canned';
import { LISTEN_SAY } from '../../src/renderer/pet/listen-ui';
import { prepareForSpeech } from '../../src/voice/speech-text';
import { createScenario, type Scenario } from './harness';

let scenario: Scenario | undefined;

afterEach(() => {
  scenario?.dispose();
  scenario = undefined;
  vi.useRealTimers();
});

// Сценарий 1 (Д17, Д22): запуск приложения, пока служба распознавания поднимается.
describe('Сценарий 1. Запуск при запускающейся службе распознавания', () => {
  it('ёж виден сразу, строка работает, приветствие нейтральное, значок в ожидании', async () => {
    scenario = createScenario({ sttStatus: 'starting' });
    const h = scenario;

    h.startApp();
    await h.flush();

    expect(h.observations.visible()).toBe(true);
    expect(h.observations.interactive()).toBe(true);
    expect(h.observations.micWaiting()).toBe(true);
    expect(h.observations.micOn()).toBe(false);
    expect(h.observations.recording()).toBe(false);
    expect(h.observations.bubble()).toBe(CANNED.neutral);
    expect(h.observations.label()).toBe('говорит');
    expect(h.observations.errors()).toEqual([]);
  });

  it('служба готова: запись включилась один раз, «Слушаю…» только после приветствия', async () => {
    scenario = createScenario({ sttStatus: 'starting' });
    const h = scenario;
    h.startApp();

    h.voiceReady();
    await h.flush();

    expect(h.observations.micOn()).toBe(true);
    expect(h.observations.commands().filter((command) => command === 'conversation-on')).toHaveLength(1);
    // приветствие ещё звучит: «Слушаю…» не показывается вместо него
    expect(h.observations.bubble()).toBe(CANNED.neutral);

    await h.wait(350);
    expect(h.observations.bubble()).toBe(LISTEN_SAY);
    expect(h.observations.recording()).toBe(true);
    expect(h.observations.errors()).toEqual([]);
  });
});

// Сценарий 2 (Д22): запуск при готовой службе, приветствие звучит и показано одинаково.
describe('Сценарий 2. Запуск при готовой службе распознавания', () => {
  it('приветствие и облачко совпадают дословно', async () => {
    scenario = createScenario({ sttStatus: 'ready' });
    const h = scenario;

    h.startApp();
    await h.flush();

    expect(h.observations.visible()).toBe(true);
    expect(h.observations.bubble()).toBe(CANNED.greeting);
    expect(h.observations.spoken()).toContain(prepareForSpeech(CANNED.greeting));
    expect(h.observations.label()).toBe('говорит');

    await h.wait(350);
    expect(h.observations.bubble()).toBe(LISTEN_SAY);
    expect(h.observations.recording()).toBe(true);
  });
});
