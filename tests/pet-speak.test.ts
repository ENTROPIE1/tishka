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
