import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScenario, type Scenario } from './harness';

let scenario: Scenario | undefined;

afterEach(() => {
  scenario?.dispose();
  scenario = undefined;
  vi.useRealTimers();
});

// Сценарий 20 (задача 112): реплика вызывает меняющий инструмент, ёж показывает
// вопрос в облачке, «да» голосом подтверждает и действие выполняется.
describe('Сценарий 20. Подтверждение меняющего инструмента голосом', () => {
  it('вопрос в облачке, «да» голосом выполняет действие', async () => {
    scenario = createScenario({ sttStatus: 'ready' });
    const h = scenario;
    h.startApp();
    await h.wait(1000);
    expect(h.observations.conversationOn()).toBe(true);

    h.coreWillConfirm('Выполнить создать задачу через jira?');
    h.sendFromComposer('создай задачу');
    await h.flush();

    // Вопрос виден в облачке, работа ещё не завершена.
    expect(h.observations.bubble()).toBe('Выполнить создать задачу через jira?');
    expect(h.observations.coreCalls()).toEqual(['создай задачу']);

    expect(h.say('да')).toBe(true);
    await h.flush();

    // «да» дошло до ядра, действие выполнено, ёж ответил.
    expect(h.observations.coreCalls()).toEqual(['создай задачу', 'да']);
    expect(h.observations.bubble()).toBe('Готово');
  });

  it('«нет» голосом не выполняет действие', async () => {
    scenario = createScenario({ sttStatus: 'ready' });
    const h = scenario;
    h.startApp();
    await h.wait(1000);

    h.coreWillConfirm('Выполнить удалить страницу через confluence?');
    h.sendFromComposer('удали страницу');
    await h.flush();
    expect(h.observations.bubble()).toBe('Выполнить удалить страницу через confluence?');

    expect(h.say('нет')).toBe(true);
    await h.flush();

    expect(h.observations.coreCalls()).toEqual(['удали страницу', 'нет']);
    expect(h.observations.bubble()).toBe('Понял, не буду');
  });
});
