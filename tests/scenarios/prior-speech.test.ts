import { afterEach, describe, expect, it, vi } from 'vitest';
import { STOP_CAPTION } from '../../src/voice/stop-phrase';
import { createScenario, type Scenario } from './harness';

let scenario: Scenario | undefined;

afterEach(() => {
  scenario?.dispose();
  scenario = undefined;
  vi.useRealTimers();
});

// Сценарий 97 (задача 97): сказанное до появления Тишки не доходит до ядра.
// Человек разговаривает рядом, затем зовёт Тишку — идущая запись сбрасывается,
// фраза, начавшаяся до готовности, репликой не становится.
describe('Сценарий 97. Сказанное до появления Тишки', () => {
  it('вызов клавишей посреди чужой фразы: в ядро не уходит ничего', async () => {
    scenario = createScenario({ sttStatus: 'ready' });
    const h = scenario;
    h.startApp();
    await h.wait(1000);

    // Ёж скрыт: просьба уйти голосом.
    h.say('тишка, уходи');
    await h.flush();
    await h.wait(4000);
    expect(h.observations.visible()).toBe(false);
    expect(h.observations.recording()).toBe(true);

    // Человек говорит без имени; запись идёт до вызова (перешагнув границу
    // отрезка прослушивания имени, чтобы посреди фразы была не пустая запись).
    h.feedMic(0.02, 6000);
    await h.flush();
    // Фраза ещё идёт: время двигается, вызова пока нет.
    await h.wait(1000);

    // Вызов клавишей посреди фразы: разговор включён, приветствие отзвучало.
    h.hotkeyCall();
    await h.wait(1200);
    expect(h.observations.conversationOn()).toBe(true);

    // Фраза продолжается и заканчивается после появления — в ядро не уходит.
    h.hear('какие встречи сегодня');
    h.feedMic(0.02, 6000);
    h.feedMic(0.001, 1000);
    await h.flush();
    expect(h.observations.coreCalls()).toEqual([]);
    expect(h.observations.dropped()).toContain('before-conversation');

    // Следующая фраза, начатая после приветствия, уходит как реплика.
    h.say('ну покажи встречи');
    await h.flush();
    expect(h.observations.coreCalls()).toEqual(['ну покажи встречи']);
  });

  it('вызов щелчком по микрофону: то же — в ядро не уходит ничего', async () => {
    scenario = createScenario({ sttStatus: 'ready' });
    const h = scenario;
    h.startApp();
    await h.wait(1000);

    h.say('тишка, уходи');
    await h.flush();
    await h.wait(4000);
    expect(h.observations.visible()).toBe(false);

    h.feedMic(0.02, 6000);
    await h.flush();
    await h.wait(1000);

    h.micClick();
    await h.wait(1200);
    expect(h.observations.conversationOn()).toBe(true);

    h.hear('открой заметки');
    h.feedMic(0.02, 6000);
    h.feedMic(0.001, 1000);
    await h.flush();
    expect(h.observations.coreCalls()).toEqual([]);
    expect(h.observations.dropped()).toContain('before-conversation');

    h.say('ну покажи заметки');
    await h.flush();
    expect(h.observations.coreCalls()).toEqual(['ну покажи заметки']);
  });

  it('включение разговора в чате: продолжение чужой фразы не доходит до ядра', async () => {
    scenario = createScenario({ sttStatus: 'ready' });
    const h = scenario;
    h.startApp();
    await h.wait(1000);

    h.say('тишка, уходи');
    await h.flush();
    await h.wait(4000);
    expect(h.observations.visible()).toBe(false);

    h.feedMic(0.02, 6000);
    await h.flush();
    await h.wait(1000);

    h.chatTalkToggle();
    await h.wait(1200);
    expect(h.observations.conversationOn()).toBe(true);

    h.hear('и открой календарь');
    h.feedMic(0.02, 6000);
    h.feedMic(0.001, 1000);
    await h.flush();
    expect(h.observations.coreCalls()).toEqual([]);
    expect(h.observations.dropped()).toContain('before-conversation');
  });

  it('эхо голоса Тишки после ответа не становится репликой', async () => {
    scenario = createScenario({ sttStatus: 'ready' });
    const h = scenario;
    h.startApp();
    await h.wait(1000);
    expect(h.observations.conversationOn()).toBe(true);

    h.say('какие встречи сегодня');
    await h.flush();
    expect(h.observations.coreCalls()).toEqual(['какие встречи сегодня']);

    // Тишка говорит ответ, микрофон слышит его голос; запись заканчивается
    // через секунду после конца речи.
    h.hear('и ещё вот это');
    h.feedMic(0.02, 800);
    await h.wait(1500);
    h.feedMic(0.001, 1000);
    await h.flush();
    expect(h.observations.coreCalls()).toEqual(['какие встречи сегодня']);
  });

  it('фраза, начатая во время ответа и закончившаяся после, не уходит; «стоп» работает', async () => {
    scenario = createScenario({ sttStatus: 'ready' });
    const h = scenario;
    h.startApp();
    await h.wait(1000);

    // Человек начинает говорить, пока Тишка работает, и продолжает после.
    h.coreWillWork(3000);
    h.sendFromComposer('сделай отчёт');
    await h.flush();
    expect(h.observations.state()).toBe('thinking');

    h.hear('а вот ещё вопрос');
    h.feedMic(0.02, 1000);
    await h.wait(2500);
    h.feedMic(0.02, 1000);
    h.feedMic(0.001, 1000);
    await h.flush();
    expect(h.observations.coreCalls()).toEqual(['сделай отчёт']);

    // «Стоп» во время ответа по-прежнему останавливает работу (задача 92).
    h.coreWillWork(3000);
    h.sendFromComposer('работай ещё');
    await h.flush();
    h.say('стоп');
    await h.flush();
    expect(h.observations.coreCalls()).toEqual(['сделай отчёт']);
    expect(h.observations.label()).toBe(STOP_CAPTION);
    expect(h.observations.conversationOn()).toBe(true);
  });

  it('вызов по имени с просьбой в одной фразе работает как раньше', async () => {
    scenario = createScenario({ sttStatus: 'ready' });
    const h = scenario;
    h.startApp();
    await h.wait(1000);

    h.say('тишка, уходи');
    await h.flush();
    await h.wait(4000);
    expect(h.observations.visible()).toBe(false);

    h.say('тишка, какие у меня встречи');
    await h.flush();
    expect(h.observations.coreCalls()).toEqual(['какие у меня встречи']);
    expect(h.observations.conversationOn()).toBe(true);
  });
});

