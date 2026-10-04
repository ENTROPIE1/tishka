import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ ipcMain: { on: vi.fn() } }));

import { defaultConfig } from '../src/core/config';
import { createEventBus } from '../src/core/events';
import { createScheduler, type SchedulerDeps } from '../src/core/triggers/scheduler';
import type { TriggerState } from '../src/core/triggers/state';
import { registerPetWake, type PetWake } from '../src/main/pet-wake';

function memoryState(reminders: TriggerState['reminders'] = []): SchedulerDeps['state'] {
  const memory: TriggerState = { reminders, firedOnce: [], watches: {} };
  return {
    load: async () => memory,
    save: async () => undefined,
    exclusive: async <T>(task: () => Promise<T>): Promise<T> => task()
  } as SchedulerDeps['state'];
}

const wakes: PetWake[] = [];

afterEach(() => {
  while (wakes.length > 0) {
    wakes.pop()?.dispose();
  }
});

function register(bus: ReturnType<typeof createEventBus>): PetWake {
  const voice = { ...defaultConfig().voice, wakeEnabled: true };
  const wake = registerPetWake({
    pet: { wakeState: () => undefined, onPageLoaded: () => undefined } as never,
    flow: {
      conversationOwner: () => null,
      isLeavingSoon: () => false,
      handlePhrase: () => undefined,
      toggleConversation: () => undefined,
      escape: () => undefined,
      reportError: () => undefined
    } as never,
    bus,
    getVoice: () => voice,
    getWarmMinutes: () => 30,
    isReady: () => true
  });
  wakes.push(wake);
  return wake;
}

describe('registerPetWake: напоминание и прослушивание имени', () => {
  it('после напоминания при выключенном синтезе прослушивание снова активно', async () => {
    const bus = createEventBus();
    const wake = register(bus);
    bus.emit({ type: 'idle' });
    expect(wake.isListening()).toBe(true);

    let now = new Date('2026-10-05T09:00:00');
    const scheduler = createScheduler({
      skills: { list: async () => [] },
      runner: { run: async () => ({ ok: true, steps: {} }) },
      state: memoryState(),
      events: bus,
      now: () => now
    });
    await scheduler.addReminder(new Date('2026-10-05T09:05:00').toISOString(), 'Напоминание');

    const duringReply: boolean[] = [];
    bus.on((event) => {
      if (event.type === 'reply') {
        duringReply.push(wake.isListening());
      }
    });

    now = new Date('2026-10-05T09:05:00');
    await scheduler.tick();

    expect(duringReply).toEqual([false]);
    expect(wake.isListening()).toBe(true);
  });
});
