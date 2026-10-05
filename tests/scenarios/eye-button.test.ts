import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScenario, type Scenario } from './harness';

let scenario: Scenario | undefined;

afterEach(() => {
  scenario?.dispose();
  scenario = undefined;
  vi.useRealTimers();
});

// Сценарий 15 (задача 85): кнопка с глазом в строке ввода ежа — переключатель
// просмотра экрана, как кнопка в чате. Вид ведут события ядра, поэтому кнопки
// в обоих окнах активны одновременно; нажатие в активном виде останавливает.
describe('Сценарий 15. Кнопка с глазом у ежа', () => {
  it('нажатие отправляет набранный текст вопросом к экрану, кнопки в обоих окнах активны', async () => {
    scenario = createScenario({ sttStatus: 'ready', talkByDefault: false });
    const h = scenario;
    h.startApp();
    await h.wait(1000);
    expect(h.observations.visible()).toBe(true);
    expect(h.observations.eyeOn()).toBe(false);
    expect(h.observations.chatEyeOn()).toBe(false);

    h.pressEye('что тут?');
    await h.flush();
    // Тот же текст просьбы, что у кнопки в чате.
    expect(h.observations.coreCalls()).toEqual(['Посмотри на экран. что тут?']);

    h.coreLooksAtScreen();
    await h.flush();
    expect(h.observations.eyeOn()).toBe(true);
    expect(h.observations.chatEyeOn()).toBe(true);
  });

  it('пустая строка отправляет общую просьбу посмотреть на экран', async () => {
    scenario = createScenario({ sttStatus: 'ready', talkByDefault: false });
    const h = scenario;
    h.startApp();
    await h.wait(1000);

    h.pressEye();
    await h.flush();

    expect(h.observations.coreCalls()).toEqual(['Посмотри, что у меня на экране']);
  });

  it('повторное нажатие останавливает просмотр и больше ничего не отправляет', async () => {
    scenario = createScenario({ sttStatus: 'ready', talkByDefault: false });
    const h = scenario;
    h.startApp();
    await h.wait(1000);

    h.pressEye();
    await h.flush();
    h.coreLooksAtScreen();
    await h.flush();
    expect(h.observations.eyeOn()).toBe(true);

    h.pressEye();
    await h.flush();
    // Остановка ушла в ядро: простой погасил кнопки в обоих окнах,
    // новая просьба не отправлялась — вызов к ядру был один.
    expect(h.observations.coreCalls().length).toBe(1);
    expect(h.observations.eyeOn()).toBe(false);
    expect(h.observations.chatEyeOn()).toBe(false);
  });

  it('запуск просмотром голосом делает кнопку активной и у ежа', async () => {
    scenario = createScenario({ sttStatus: 'ready' });
    const h = scenario;
    h.startApp();
    await h.wait(400);
    expect(h.observations.micOn()).toBe(true);

    expect(h.say('посмотри на экран')).toBe(true);
    await h.flush();
    expect(h.observations.coreCalls()).toContain('посмотри на экран');

    h.coreLooksAtScreen();
    await h.flush();
    expect(h.observations.eyeOn()).toBe(true);
    expect(h.observations.chatEyeOn()).toBe(true);
  });

  it('выключенный в настройках просмотр экрана скрывает кнопку и не отправляет просьбу', async () => {
    scenario = createScenario({ sttStatus: 'ready', talkByDefault: false, screenEnabled: false });
    const h = scenario;
    h.startApp();
    await h.wait(1000);
    expect(h.observations.visible()).toBe(true);
    expect(h.observations.eyeHidden()).toBe(true);

    h.pressEye('что тут?');
    await h.flush();
    expect(h.observations.coreCalls()).toEqual([]);
    expect(h.observations.eyeOn()).toBe(false);
  });
});
