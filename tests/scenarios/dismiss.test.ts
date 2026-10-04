import { afterEach, describe, expect, it, vi } from 'vitest';
import { DISMISS_REPLY } from '../../src/voice/wake';
import { prepareForSpeech } from '../../src/voice/speech-text';
import { createScenario, type Scenario } from './harness';

let scenario: Scenario | undefined;

afterEach(() => {
  scenario?.dispose();
  scenario = undefined;
  vi.useRealTimers();
});

// Сценарий 4 (Д16): просьба уйти — ответ показан и произнесён, затем уход
// и скрытие за секунды; пока ёж виден, строка работает.
describe('Сценарий 4. «Тишка, уходи» и «можешь быть свободен»', () => {
  it('«Тишка, уходи»: ответ показан и произнесён, затем уход и скрытие', async () => {
    scenario = createScenario({ sttStatus: 'ready' });
    const h = scenario;
    h.startApp();
    await h.wait(400);
    expect(h.observations.micOn()).toBe(true);

    h.say('Тишка, уходи');
    await h.flush();
    expect(h.observations.bubble()).toBe(DISMISS_REPLY);
    expect(h.observations.spoken()).toContain(prepareForSpeech(DISMISS_REPLY));
    expect(h.observations.micOn()).toBe(false);
    expect(h.observations.interactive()).toBe(true);

    await h.wait(4000);
    expect(h.observations.visible()).toBe(false);
  });

  it('при недоступной речи — то же: ответ текстом, уход и скрытие', async () => {
    scenario = createScenario({ sttStatus: 'ready', tts: 'unreachable' });
    const h = scenario;
    h.startApp();
    await h.wait(400);

    h.say('Тишка, уходи');
    await h.flush();
    expect(h.observations.bubble()).toBe(DISMISS_REPLY);
    expect(h.observations.micOn()).toBe(false);
    expect(h.observations.interactive()).toBe(true);

    await h.wait(4000);
    expect(h.observations.visible()).toBe(false);
  });

  // Найденный дефект (Д16): фраза «можешь быть свободен» не распознаётся как
  // просьба уйти — isDismiss сравнивает фразу целиком со списком «свободен»,
  // «можешь идти», а «можешь быть свободен» в списке нет, и реплика уходит
  // в ядро как обычный вопрос: ёж отвечает, но не уходит.
  it.fails('«можешь быть свободен»: ответ показан и произнесён, затем уход и скрытие', async () => {
    scenario = createScenario({ sttStatus: 'ready' });
    const h = scenario;
    h.startApp();
    await h.wait(400);
    expect(h.observations.micOn()).toBe(true);

    h.say('можешь быть свободен');
    await h.flush();
    expect(h.observations.bubble()).toBe(DISMISS_REPLY);
    expect(h.observations.spoken()).toContain(prepareForSpeech(DISMISS_REPLY));

    await h.wait(4000);
    expect(h.observations.visible()).toBe(false);
  });
});
