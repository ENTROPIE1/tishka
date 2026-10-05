import { afterEach, describe, expect, it, vi } from 'vitest';
import { STOP_CAPTION } from '../../src/voice/stop-phrase';
import { createScenario, type Scenario } from './harness';

let scenario: Scenario | undefined;

afterEach(() => {
  scenario?.dispose();
  scenario = undefined;
  vi.useRealTimers();
});

// Сценарий 18 (задача 92): слово «стоп» голосом во время работы останавливает
// работу и речь, в ядро как реплика не уходит; ёж показывает подписью
// «остановил» и остаётся слушать.
describe('Сценарий 18. «Стоп» голосом во время работы', () => {
  it('стоп в разговоре останавливает работу и не уходит в ядро', async () => {
    scenario = createScenario({ sttStatus: 'ready' });
    const h = scenario;
    h.startApp();
    await h.wait(1000);
    expect(h.observations.conversationOn()).toBe(true);

    // Тишка занят: работа идёт три секунды, микрофон продолжает слушать.
    h.coreWillWork(3000);
    h.sendFromComposer('сделай отчёт');
    await h.flush();
    expect(h.observations.state()).toBe('thinking');
    expect(h.observations.recording()).toBe(true);

    expect(h.say('стоп')).toBe(true);
    await h.flush();
    // «стоп» в ядро как реплика не ушёл.
    expect(h.observations.coreCalls()).toEqual(['сделай отчёт']);
    // Ёж коротко показывает подписью «остановил» и остаётся слушать.
    expect(h.observations.label()).toBe(STOP_CAPTION);
    expect(h.observations.conversationOn()).toBe(true);
    expect(h.observations.micOn()).toBe(true);
    expect(h.observations.recording()).toBe(true);

    // Подпись уходит, работа прервана (ход ядра доигрывает отмену), разговор жив.
    await h.wait(3500);
    expect(h.observations.label()).toBe('ждёт');
    expect(h.observations.conversationOn()).toBe(true);
  });

  it('останавливается и по другим словам остановки, и с именем', async () => {
    scenario = createScenario({ sttStatus: 'ready' });
    const h = scenario;
    h.startApp();
    await h.wait(1000);

    for (const phrase of ['Тишка, хватит', 'остановись', 'отмена']) {
      h.coreWillWork(2000);
      h.sendFromComposer('работай');
      await h.flush();
      const callsBefore = h.observations.coreCalls().length;
      expect(h.say(phrase)).toBe(true);
      await h.flush();
      // Слово остановки в ядро как реплика не уходит.
      expect(h.observations.coreCalls().length).toBe(callsBefore);
      expect(h.observations.label()).toBe(STOP_CAPTION);
      expect(h.observations.conversationOn()).toBe(true);
      await h.wait(2200);
    }
  });

  it('в покое те же слова уходят в ядро как обычная реплика', async () => {
    scenario = createScenario({ sttStatus: 'ready' });
    const h = scenario;
    h.startApp();
    await h.wait(1000);

    expect(h.say('стоп')).toBe(true);
    await h.flush();
    expect(h.observations.coreCalls()).toEqual(['стоп']);
    expect(h.observations.bubble()).toBe('Готово');
    expect(h.observations.label()).not.toBe(STOP_CAPTION);
    expect(h.observations.conversationOn()).toBe(true);
  });
});

// Сценарий 19 (задача 92): в строке ежа, пока Тишка занят, кнопка отправки
// останавливает работу, и Escape делает то же.
describe('Сценарий 19. Кнопка остановки в строке ежа', () => {
  it('кнопка отправки становится остановкой и останавливает работу', async () => {
    scenario = createScenario({ sttStatus: 'ready', talkByDefault: false });
    const h = scenario;
    h.startApp();
    await h.wait(1000);
    expect(h.observations.sendIsStop()).toBe(false);

    h.coreWillWork(3000);
    h.sendFromComposer('сделай отчёт');
    await h.flush();
    expect(h.observations.state()).toBe('thinking');
    expect(h.observations.sendIsStop()).toBe(true);

    h.pressPetSend();
    await h.wait(3500);
    // Работа остановлена: ход завершился «Остановлено», без ответа по существу.
    expect(h.observations.state()).toBe('idle');
    expect(h.observations.coreCalls()).toEqual(['сделай отчёт']);
    expect(h.observations.sendIsStop()).toBe(false);
  });

  it('Escape в строке ежа останавливает работу', async () => {
    scenario = createScenario({ sttStatus: 'ready', talkByDefault: false });
    const h = scenario;
    h.startApp();
    await h.wait(1000);

    h.coreWillWork(3000);
    h.sendFromComposer('сделай отчёт');
    await h.flush();
    expect(h.observations.sendIsStop()).toBe(true);

    h.pressPetEscape();
    await h.wait(3500);
    expect(h.observations.state()).toBe('idle');
    expect(h.observations.coreCalls()).toEqual(['сделай отчёт']);
  });
});
