import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScenario, type Scenario } from './harness';

let scenario: Scenario | undefined;

afterEach(() => {
  scenario?.dispose();
  scenario = undefined;
  vi.useRealTimers();
});

// Сценарий 87: разговор выключен, ёж слушает только имя. Непрерывный шум выше
// порога не даёт детектору увидеть тишину, поэтому фраза уходит на
// распознавание отрезками по 4 секунды; имя распознаётся не позже чем через
// один отрезок после того, как его сказали.
describe('Сценарий 87. Имя на фоне непрерывного шума', () => {
  it('«Тишка» на фоне шума распознаётся в границах одного отрезка', async () => {
    scenario = createScenario({ sttStatus: 'ready', talkByDefault: false });
    const h = scenario;
    h.startApp();
    await h.flush();
    expect(h.observations.conversationOn()).toBe(false);

    // Фон: непрерывный шум выше порога, тишины детектор не видит.
    h.feedMic(0.02, 4200);
    await h.flush();
    expect(h.observations.sttRequests()).toBe(1);
    expect(h.observations.commands()).not.toContain('listen');

    // Человек зовёт «Тишка» на фоне того же шума: отрезок с именем уходит
    // на распознавание, ёж откликается.
    h.hear('тишка');
    h.feedMic(0.02, 2800);
    h.feedMic(0.1, 1200);
    await h.flush();
    expect(h.observations.sttRequests()).toBe(2);
    expect(h.observations.commands()).toContain('listen');
    expect(h.observations.listening()).toBe(true);
    expect(h.observations.errors()).toEqual([]);
  });

  it('в разговоре реплика не режется: предел длины прежний', async () => {
    scenario = createScenario({ sttStatus: 'ready' });
    const h = scenario;
    h.startApp();
    await h.wait(1000);
    expect(h.observations.conversationOn()).toBe(true);

    h.feedMic(0.02, 9000);
    await h.flush();
    // Отрезки прослушивания имени в разговоре не применяются.
    expect(h.observations.sttRequests()).toBe(0);

    h.feedMic(0.001, 1000);
    await h.flush();
    expect(h.observations.sttRequests()).toBe(1);
  });
});
