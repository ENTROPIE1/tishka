import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScenario, type Scenario } from './harness';

let scenario: Scenario | undefined;

afterEach(() => {
  scenario?.dispose();
  scenario = undefined;
  vi.useRealTimers();
});

// Сценарий 109 (задача 109): фраза, начатая во время обдумывания, не проходит
// репликой, даже если между обдумыванием и речью Тишки был короткий простой.
// Помнится не один последний отрезок занятости, а все за последние две минуты.
describe('Сценарий 109. Короткий простой между обдумыванием и речью', () => {
  it('фраза, начатая во время обдумывания, отброшена после простоя 0,5 с и начала речи', async () => {
    scenario = createScenario({ sttStatus: 'ready' });
    const h = scenario;
    h.startApp();
    await h.wait(1000);
    expect(h.observations.conversationOn()).toBe(true);

    // Тишка думает; человек начинает говорить в это время.
    h.coreThinking();
    await h.wait(300);
    h.feedMic(0.02, 800);
    await h.wait(200);

    // Обдумывание кончилось, короткий простой 0,5 с, затем Тишка заговорил.
    h.coreIdle();
    await h.wait(500);
    h.coreSpeaking();
    h.feedMic(0.02, 800);

    // Речь Тишки кончилась: запись сброшена, но начало фразы запомнено.
    await h.wait(500);
    h.coreSpeechEnd();
    h.feedMic(0.02, 800);

    // Фраза распознаётся уже после речи; долгая тишина закрывает запись.
    h.hear('какие встречи сегодня');
    h.feedMic(0.001, 1000);
    await h.flush();
    await h.wait(100);

    expect(h.observations.coreCalls()).toEqual([]);
    expect(h.observations.dropped()).toContain('during-answer');
  });
});
