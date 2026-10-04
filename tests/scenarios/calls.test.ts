import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScenario, type Scenario } from './harness';

let scenario: Scenario | undefined;

afterEach(() => {
  scenario?.dispose();
  scenario = undefined;
  vi.useRealTimers();
});

// Ёж, который ушёл после приветствия: любой вызов начинается со скрытого окна.
async function hiddenPet(): Promise<Scenario> {
  const h = createScenario({ sttStatus: 'ready' });
  h.startApp();
  await h.wait(400);
  h.say('Тишка, уходи');
  await h.wait(4000);
  expect(h.observations.visible()).toBe(false);
  return h;
}

// Появление после любого вида вызова: на месте, строка принимает щелчки,
// запись включена (Д9, Д10).
async function expectAppearance(h: Scenario, call: () => void): Promise<void> {
  const before = h.observations.bounds();
  call();
  await h.flush();

  expect(h.observations.visible()).toBe(true);
  expect(h.observations.bounds()).toEqual(before);
  expect(h.observations.interactive()).toBe(true);

  await h.wait(1100);
  expect(h.observations.state()).toBe('listening');
  expect(h.observations.label()).toBe('слушает');
  expect(h.observations.recording()).toBe(true);
  expect(h.observations.micOn()).toBe(true);
  expect(h.observations.composerVisible()).toBe(true);
  expect(h.observations.errors()).toEqual([]);
}

// Сценарий 3 (Д9, Д10): клавиша, имя и значок дают одно и то же появление.
describe('Сценарий 3. Вызов клавишей, по имени и щелчком по значку', () => {
  it('вызов клавишей: появление на месте, строка принимает щелчки', async () => {
    scenario = await hiddenPet();
    await expectAppearance(scenario, () => scenario?.hotkeyCall());
  });

  it('вызов по имени: появление на месте, строка принимает щелчки', async () => {
    scenario = await hiddenPet();
    await expectAppearance(scenario, () => {
      expect(scenario?.say('тишка')).toBe(true);
    });
  });

  it('щелчок по значку: появление на месте, строка принимает щелчки', async () => {
    scenario = await hiddenPet();
    await expectAppearance(scenario, () => scenario?.trayCall());
  });
});

// Сценарий 5 (Д4): после ухода вызов снова работает и включает запись.
describe('Сценарий 5. Вызов после ухода', () => {
  it('по имени: ёж появляется, запись включается', async () => {
    scenario = await hiddenPet();
    const h = scenario;

    expect(h.say('тишка')).toBe(true);
    await h.wait(1000);
    expect(h.observations.visible()).toBe(true);
    expect(h.observations.recording()).toBe(true);
    expect(h.observations.micOn()).toBe(true);
  });

  it('клавишей: ёж появляется, запись включается', async () => {
    scenario = await hiddenPet();
    const h = scenario;

    h.hotkeyCall();
    await h.wait(1000);
    expect(h.observations.visible()).toBe(true);
    expect(h.observations.recording()).toBe(true);
    expect(h.observations.micOn()).toBe(true);
  });
});
