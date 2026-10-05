import { afterEach, describe, expect, it, vi } from 'vitest';
import { replyFromToolArgs } from '../../src/core/agent/reply';
import { createScenario, type Scenario } from './harness';

let scenario: Scenario | undefined;

afterEach(() => {
  scenario?.dispose();
  scenario = undefined;
  vi.useRealTimers();
});

// Сценарий: ответ с меткой эмоции посреди реплики — в ленте и озвучке метки
// нет, окно получает смену эмоции вместе со звуком.
describe('Сценарий: смена эмоции посреди реплики', () => {
  it('метка вырезана из текста, окно получило эмоцию и дорожку рта', async () => {
    const reply = replyFromToolArgs({ say: 'Сейчас посмотрю. [happy] Нашёл!' }, null);
    scenario = createScenario({ sttStatus: 'ready', talkTimeoutSec: 300, tts: 'ok', reply });
    const h = scenario;
    h.startApp();
    await h.wait(1000);

    h.say('посмотри, что там');
    await h.wait(2000);

    const spoken = h.observations.spoken();
    const said = spoken[spoken.length - 1];
    expect(said).not.toContain('[');
    expect(said).toContain('Нашёл');
    expect(h.observations.speakMoods()).toContain('happy');
    expect(h.observations.speakMouth()).toBe(true);
  });

  it('настроение ответа задаёт эмоцию лица и сбрасывается в покое', async () => {
    const reply = replyFromToolArgs({ say: 'Сейчас посмотрю. [happy] Нашёл!', mood: 'confused' }, null);
    scenario = createScenario({ sttStatus: 'ready', talkTimeoutSec: 300, tts: 'ok', reply });
    const h = scenario;
    h.startApp();
    await h.wait(1000);

    h.say('посмотри, что там');
    await h.flush();

    // Начало звука: настроение ответа на лице, метка ушла окну вместе со звуком.
    expect(h.observations.faceMood()).toBe('confused');
    expect(h.observations.speakMoods()).toContain('happy');

    // Речь закончилась, ёж в покое: лицо вернулось к neutral.
    await h.wait(2000);
    expect(h.observations.state()).toBe('idle');
    expect(h.observations.faceMood()).toBe('neutral');
  });

  it('ответ текстом без звука тоже задаёт эмоцию лица', async () => {
    const reply = replyFromToolArgs({ say: 'Готово', mood: 'happy' }, null);
    scenario = createScenario({ sttStatus: 'ready', talkTimeoutSec: 300, tts: 'rejected', reply });
    const h = scenario;
    h.startApp();
    await h.wait(1000);

    h.say('сделай');
    await h.flush();

    // Звука нет: эмоция лица проходит через настроение ответа.
    expect(h.observations.faceMoods()).toContain('happy');
  });
});
