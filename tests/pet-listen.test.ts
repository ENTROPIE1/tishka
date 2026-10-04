import { describe, expect, it } from 'vitest';
import { createEventBus } from '../src/core/events';
import type { TishkaEvent } from '../src/core/types';
import { createPetListen } from '../src/main/pet-listen';

function makeListen() {
  const bus = createEventBus();
  const events: TishkaEvent[] = [];
  bus.on((event) => events.push(event));
  const listen = createPetListen({
    bus,
    core: { handleUserText: async () => ({ say: 'ок' }) } as never,
    stt: { status: () => 'ready', transcribe: async () => ({ ok: true, text: 'тест' }) } as never,
    sendCommand: () => undefined
  });
  listen.toggle('click');
  return { listen, events };
}

describe('createPetListen: завершение одиночной записи', () => {
  it('«Не расслышал» завершается событием idle после ошибки', () => {
    const { listen, events } = makeListen();
    listen.handleResult({ kind: 'nospeech' });
    const types = events.map((event) => event.type);
    expect(types).toContain('error');
    expect(types).toContain('idle');
    expect(types.indexOf('idle')).toBeGreaterThan(types.indexOf('error'));
  });

  it('ошибка записи завершается событием idle после ошибки', () => {
    const { listen, events } = makeListen();
    listen.handleResult({ kind: 'error', message: 'Микрофон недоступен' });
    const types = events.map((event) => event.type);
    expect(types).toContain('error');
    expect(types).toContain('idle');
  });

  it('cancel по-прежнему завершается событием idle', () => {
    const { listen, events } = makeListen();
    listen.handleResult({ kind: 'cancel' });
    expect(events.some((event) => event.type === 'idle')).toBe(true);
  });
});
