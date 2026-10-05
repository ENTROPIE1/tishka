import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOISE } from './edges';
import { createScenario, type Scenario } from './harness';

let scenario: Scenario | undefined;

afterEach(() => {
  scenario?.dispose();
  scenario = undefined;
  vi.useRealTimers();
});

// Сценарий 8 (Д19): шум вместо речи в разговоре остаётся без последствий.
describe('Сценарий 8. Шум вместо речи в разговоре', () => {
  it('ни облачка с ошибкой, ни речи; тишина не продлевает разговор', async () => {
    scenario = createScenario({ sttStatus: 'ready' });
    const h = scenario;
    h.startApp();
    await h.wait(1000);
    const bubbleBefore = h.observations.bubble();
    const spokenBefore = h.observations.spoken().length;

    h.noise();
    await h.flush();
    expect(h.observations.errors()).toEqual([]);
    expect(h.observations.spoken().length).toBe(spokenBefore);
    expect(h.observations.bubble()).toBe(bubbleBefore);
    expect(h.observations.coreCalls()).toEqual([]);
    expect(h.observations.conversationOn()).toBe(true);

    // шум на двадцатой секунде не продлевает срок тишины: на 31-й разговор закрыт
    await h.wait(20000);
    h.noise();
    await h.flush();
    await h.wait(11000);
    expect(h.observations.conversationOn()).toBe(false);
    expect(h.observations.micOn()).toBe(false);
  });
});

// Сценарий 9 (Д21): удержание ежа мышью молчит и не отправляет фразу.
describe('Сценарий 9. Нажатие и удержание ежа мышью', () => {
  it('запись на паузе, фраза за это время не уходит на распознавание', async () => {
    scenario = createScenario({ sttStatus: 'ready' });
    const h = scenario;
    h.startApp();
    await h.wait(1000);
    expect(h.observations.recording()).toBe(true);

    h.pressPet();
    expect(h.observations.recording()).toBe(false);
    expect(h.say('привет')).toBe(false);
    await h.flush();
    expect(h.observations.sttRequests()).toBe(0);

    h.releasePet();
    expect(h.say('и ещё фраза')).toBe(false);
    await h.flush();
    expect(h.observations.sttRequests()).toBe(0);

    await h.wait(1000);
    expect(h.observations.recording()).toBe(true);
    expect(h.say('тишка')).toBe(true);
    await h.flush();
    expect(h.observations.sttRequests()).toBe(1);
  });
});

// Сценарий 13: тишина в разговоре дольше срока — предупреждение и уход.
describe('Сценарий 13. Тишина в разговоре дольше срока', () => {
  it('ёж предупреждает видом и уходит, до ухода строка работает', async () => {
    scenario = createScenario({ sttStatus: 'ready', talkTimeoutSec: 3 });
    const h = scenario;
    h.startApp();
    await h.flush();
    expect(h.observations.soon()).toBe(true);
    expect(h.observations.interactive()).toBe(true);

    h.sendFromComposer('как дела');
    await h.flush();
    expect(h.observations.bubble()).toBe('Готово');
    expect(h.observations.interactive()).toBe(true);

    await h.wait(3500);
    expect(h.observations.visible()).toBe(false);
    expect(h.observations.conversationOn()).toBe(false);
  });
});

// Сценарий 15 (задача 88): медленное распознавание фразы не закрывает разговор.
describe('Сценарий 15. Медленное распознавание фразы в разговоре', () => {
  it('пока фраза распознаётся, таймер тишины стоит; речь заводит его заново', async () => {
    scenario = createScenario({ sttStatus: 'ready', talkTimeoutSec: 10 });
    const h = scenario;
    h.startApp();
    await h.wait(1000);
    expect(h.observations.conversationOn()).toBe(true);

    // Фраза сказана на 2-й секунде, служба распознаёт её 15 секунд.
    h.hear('какие встречи сегодня', 15000);
    expect(h.say('какие встречи сегодня')).toBe(true);
    await h.wait(12000);
    // Срок тишины (10 с) прошёл, а фраза ещё распознаётся: разговор жив.
    expect(h.observations.conversationOn()).toBe(true);
    await h.wait(3000);
    await h.flush();
    expect(h.observations.coreCalls()).toEqual(['какие встречи сегодня']);
    // После речи разговор жив ещё полный срок.
    await h.wait(9500);
    expect(h.observations.conversationOn()).toBe(true);
    await h.wait(500);
    expect(h.observations.conversationOn()).toBe(false);
    expect(h.observations.micOn()).toBe(false);
  });

  it('пустой результат не продлевает срок: отсчёт продолжается с места остановки', async () => {
    scenario = createScenario({ sttStatus: 'ready', talkTimeoutSec: 10 });
    const h = scenario;
    h.startApp();
    await h.wait(1000);

    // Шум сказан на 2-й секунде, служба отвечает 8 секунд.
    h.hear(NOISE, 8000);
    h.noise();
    await h.flush();
    await h.wait(9000);
    // Распознавание шло 9 секунд, но отсчёт стоял: разговор жив.
    expect(h.observations.conversationOn()).toBe(true);
    // После пустого результата продолжаются оставшиеся 9 секунд тишины.
    await h.wait(7500);
    expect(h.observations.conversationOn()).toBe(true);
    await h.wait(1000);
    expect(h.observations.conversationOn()).toBe(false);
  });
});
