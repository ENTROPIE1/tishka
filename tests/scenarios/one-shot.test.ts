import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScenario, type Scenario } from './harness';
import { NOISE } from './edges';

let scenario: Scenario | undefined;

afterEach(() => {
  scenario?.dispose();
  scenario = undefined;
  vi.useRealTimers();
});

// Сценарий 100 (Д37): молчаливая отправка текста не оставляет сообщения об
// ошибке от идущей разовой записи, в ленте только реплика и ответ.
describe('Сценарий 100. Отправка текста при идущей разовой записи', () => {
  it('печать и отправка отменяют запись, лишних сообщений нет', async () => {
    scenario = createScenario({ sttStatus: 'ready', talkByDefault: false });
    const h = scenario;
    h.startApp();
    await h.wait(1000);

    // Вызов по имени запустил разовую запись приложения.
    expect(h.say('тишка')).toBe(true);
    await h.flush();
    expect(h.observations.commands()).toContain('listen');

    h.typeKey();
    h.sendFromComposer('привет');
    await h.flush();

    expect(h.observations.errors()).toEqual([]);
    expect(h.observations.coreCalls()).toEqual(['привет']);
  });
});

// Сценарий 101 (Д38): ручная разовая запись, человек промолчал — тишина без
// сообщения: звука выше порога не было, показывать «Не расслышал» не из чего.
describe('Сценарий 101. Ручная запись и тишина', () => {
  it('тишина не создаёт сообщения, запись завершается', async () => {
    scenario = createScenario({ sttStatus: 'ready', talkByDefault: false });
    const h = scenario;
    h.startApp();
    await h.wait(1000);

    h.micRecord();
    h.recordSilence();
    await h.flush();

    expect(h.observations.errors()).toEqual([]);
  });
});

// Сценарий 102 (Д38): ручная разовая запись, звук выше порога, но слов не
// разобрали — «Не расслышал» показывается ровно один раз.
describe('Сценарий 102. Ручная запись и шум без слов', () => {
  it('«Не расслышал» показывается один раз', async () => {
    scenario = createScenario({ sttStatus: 'ready', talkByDefault: false });
    const h = scenario;
    h.startApp();
    await h.wait(1000);

    h.micRecord();
    h.hear(NOISE);
    h.recordNoise();
    await h.flush();

    expect(h.observations.errors()).toEqual(['Не расслышал']);
  });
});

// Сценарий 103 (Д38): разовая запись после вызова по имени — не ручная:
// тишина в ней молчит так же, как при нажатом микрофоне.
describe('Сценарий 103. Запись приложения и тишина', () => {
  it('тишина после вызова по имени не создаёт сообщения', async () => {
    scenario = createScenario({ sttStatus: 'ready', talkByDefault: false });
    const h = scenario;
    h.startApp();
    await h.wait(1000);

    expect(h.say('тишка')).toBe(true);
    await h.flush();
    expect(h.observations.commands()).toContain('listen');

    h.recordSilence();
    await h.flush();

    expect(h.observations.errors()).toEqual([]);
  });
});
