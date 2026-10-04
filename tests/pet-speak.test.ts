import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config';
import { createEventBus } from '../src/core/events';
import type { Config, TishkaEvent } from '../src/core/types';
import { createSpeechOutput } from '../src/main/pet-speak';
import { CANNED } from '../src/voice/canned';
import { prepareForSpeech } from '../src/voice/speech-text';

function config(): Config {
  const base = defaultConfig();
  base.voice.tts.enabled = true;
  return base;
}

function spokenTexts(events: TishkaEvent[]): string[] {
  return events.filter((event) => event.type === 'speak.start').map((event) => event.text);
}

async function flush(): Promise<void> {
  for (let index = 0; index < 12; index += 1) {
    await Promise.resolve();
  }
}

function setup(ready = true): { bus: ReturnType<typeof createEventBus>; events: TishkaEvent[] } {
  const bus = createEventBus();
  const events: TishkaEvent[] = [];
  createSpeechOutput({
    bus,
    getConfig: () => config(),
    isReady: () => ready,
    play: () => new Promise<void>(() => undefined),
    fetch: (async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })) as unknown as typeof fetch
  });
  bus.on((event) => events.push(event));
  return { bus, events };
}

describe('createSpeechOutput: приветствие и уведомление', () => {
  it('уведомление по триггеру: приветствие «Слушаю» не звучит, звучит текст напоминания', async () => {
    const { bus, events } = setup();

    bus.emit({ type: 'wake', source: 'trigger' });
    bus.emit({ type: 'notify', title: 'Напоминание' });
    bus.emit({ type: 'reply', reply: { say: 'Напоминание' } });
    await flush();

    const spoken = spokenTexts(events);
    expect(spoken).not.toContain(prepareForSpeech(CANNED.greeting));
    expect(spoken).toContain(prepareForSpeech('Напоминание'));
  });

  it('появление по имени по-прежнему начинается с приветствия', async () => {
    const { bus, events } = setup();

    bus.emit({ type: 'wake', source: 'name' });
    await flush();

    expect(spokenTexts(events)).toContain(prepareForSpeech(CANNED.greeting));
  });

  it('служба ещё поднимается: «слушаю» не обещаем, звучит нейтральное приветствие', async () => {
    const { bus, events } = setup(false);

    bus.emit({ type: 'wake', source: 'click' });
    await flush();

    const spoken = spokenTexts(events);
    expect(spoken).toContain(prepareForSpeech(CANNED.neutral));
    expect(spoken).not.toContain(prepareForSpeech(CANNED.greeting));
  });
});

type Mode = 'ok' | 'rejected' | 'unreachable';

function errors(events: TishkaEvent[]): string[] {
  return events.filter((event) => event.type === 'error').map((event) => event.message);
}

function harness(): {
  bus: ReturnType<typeof createEventBus>;
  events: TishkaEvent[];
  mode: { kind: Mode };
  calls: { count: number };
  clock: { now: number };
} {
  const bus = createEventBus();
  const events: TishkaEvent[] = [];
  const mode = { kind: 'ok' as Mode };
  const calls = { count: 0 };
  const clock = { now: 0 };
  const fetchMock = (async () => {
    calls.count += 1;
    if (mode.kind === 'unreachable') {
      throw new Error('ECONNREFUSED');
    }
    if (mode.kind === 'rejected') {
      return new Response('{}', { status: 500 });
    }
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  }) as unknown as typeof fetch;
  createSpeechOutput({
    bus,
    getConfig: () => config(),
    play: () => Promise.resolve(),
    fetch: fetchMock,
    now: () => clock.now
  });
  bus.on((event) => events.push(event));
  return { bus, events, mode, calls, clock };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 50; index += 1) {
    await Promise.resolve();
  }
}

describe('createSpeechOutput: устойчивость синтеза', () => {
  it('ошибка 500 на одной реплике не глушит следующую', async () => {
    const h = harness();
    h.mode.kind = 'rejected';
    h.bus.emit({ type: 'reply', reply: { say: 'Первая реплика' } });
    await settle();

    h.mode.kind = 'ok';
    h.bus.emit({ type: 'reply', reply: { say: 'Вторая реплика' } });
    await settle();

    expect(spokenTexts(h.events)).not.toContain(prepareForSpeech('Первая реплика'));
    expect(spokenTexts(h.events)).toContain(prepareForSpeech('Вторая реплика'));
    expect(errors(h.events)).toHaveLength(0);
    expect(h.calls.count).toBe(2);
  });

  it('обрыв: пауза 15 секунд, сообщение, восстановление и повторный уход', async () => {
    const h = harness();
    h.mode.kind = 'unreachable';
    h.bus.emit({ type: 'reply', reply: { say: 'Раз реплика' } });
    await settle();
    expect(errors(h.events)).toHaveLength(1);
    expect(h.calls.count).toBe(1);

    h.clock.now = 14000;
    h.bus.emit({ type: 'reply', reply: { say: 'Два реплика' } });
    await settle();
    expect(h.calls.count).toBe(1);

    h.clock.now = 20000;
    h.mode.kind = 'ok';
    h.bus.emit({ type: 'reply', reply: { say: 'Три реплика' } });
    await settle();
    expect(h.calls.count).toBe(2);
    expect(spokenTexts(h.events)).toContain(prepareForSpeech('Три реплика'));
    expect(errors(h.events)).toHaveLength(1);

    h.mode.kind = 'unreachable';
    h.clock.now = 100000;
    h.bus.emit({ type: 'reply', reply: { say: 'Четыре реплика' } });
    await settle();
    expect(errors(h.events)).toHaveLength(2);
  });
});
