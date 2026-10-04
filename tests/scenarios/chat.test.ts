import { afterEach, describe, expect, it, vi } from 'vitest';
import { CANNED } from '../../src/voice/canned';
import { prepareForSpeech } from '../../src/voice/speech-text';
import { createScenario, type Scenario } from './harness';

let scenario: Scenario | undefined;

afterEach(() => {
  scenario?.dispose();
  scenario = undefined;
  vi.useRealTimers();
});

// Сценарий 10 (Д8): реплика из окна чата не будит и не засвечивает ежа.
describe('Сценарий 10. Реплика из окна чата', () => {
  // Найденный дефект (Д8, Н14): сам ответ из чата скрытого ежа не поднимает,
  // но озвучка ответа приходит позже, когда шина уже считает источник «ёж»,
  // и speak.start поднимает скрытого ежа: состояние «appear» вместо «hidden».
  // Источник реплики сопровождает озвучку, и скрытый ёж не появляется.
  it('скрытый ёж не появляется', async () => {
    scenario = createScenario({ sttStatus: 'ready', talkTimeoutSec: 3 });
    const h = scenario;
    h.startApp();
    await h.wait(4000);
    expect(h.observations.visible()).toBe(false);
    const spokenBefore = h.observations.spoken().length;

    h.sendFromChat('привет из чата');
    await h.flush();
    expect(h.observations.visible()).toBe(false);
    expect(h.observations.state()).toBe('hidden');
    // ответ из чата озвучивается, но не приветствием
    expect(h.observations.spoken().slice(spokenBefore)).not.toContain(prepareForSpeech(CANNED.greeting));
  });

  it('видимый не показывает облачко и карточку', async () => {
    scenario = createScenario({ sttStatus: 'ready', talkByDefault: false });
    const h = scenario;
    h.startApp();
    await h.wait(1000);
    expect(h.observations.visible()).toBe(true);
    expect(h.observations.bubble()).toBe('');
    expect(h.observations.card()).toBe(false);

    h.sendFromChat('привет из чата');
    await h.flush();
    expect(h.observations.visible()).toBe(true);
    expect(h.observations.state()).toBe('talking');
    expect(h.observations.bubble()).toBe('');
    expect(h.observations.card()).toBe(false);
  });
});

// Сценарий 12 (задача 62): уведомление от навыка — появление без «Слушаю»,
// после него отклик на имя работает.
describe('Сценарий 12. Уведомление от навыка', () => {
  it('ёж появляется, «Слушаю» не звучит, по имени после этого откликается', async () => {
    scenario = createScenario({ sttStatus: 'ready', talkTimeoutSec: 3 });
    const h = scenario;
    h.startApp();
    await h.wait(4000);
    expect(h.observations.visible()).toBe(false);
    const spokenBefore = h.observations.spoken().length;

    h.notifyFromSkill('Пора отдохнуть');
    await h.flush();
    expect(h.observations.visible()).toBe(true);
    await h.wait(1000);
    expect(h.observations.state()).toBe('notify');
    expect(h.observations.bubble()).toBe('Пора отдохнуть');
    // уведомление ничего не озвучило, «Слушаю» не появилось
    expect(h.observations.spoken().length).toBe(spokenBefore);

    expect(h.say('тишка')).toBe(true);
    await h.wait(1000);
    expect(h.observations.micOn()).toBe(true);
    expect(h.observations.recording()).toBe(true);
    // после вызова по имени приветствие прозвучало
    expect(h.observations.spoken().length).toBeGreaterThan(spokenBefore);
    expect(h.observations.spoken()).toContain(prepareForSpeech(CANNED.greeting));
  });
});
