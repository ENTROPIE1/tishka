import { describe, expect, it } from 'vitest';
import { createEventBus } from '../src/core/events';
import type { TishkaEvent } from '../src/core/types';
import type { TranscribeResult } from '../src/voice/stt-service';
import { createPetListen } from '../src/main/pet-listen';

function setup(outcome: TranscribeResult = { ok: true, text: 'тест' }) {
  const bus = createEventBus();
  const events: TishkaEvent[] = [];
  bus.on((event) => events.push(event));
  let missed = 0;
  const listen = createPetListen({
    bus,
    core: { handleUserText: async () => ({ say: 'ок' }) } as never,
    stt: { status: () => 'ready', transcribe: async () => outcome } as never,
    sendCommand: () => undefined,
    onMissedSpeech: () => {
      missed += 1;
    }
  });
  const errors = (): string[] =>
    events.filter((event) => event.type === 'error').map((event) => event.message);
  const idles = (): number => events.filter((event) => event.type === 'idle').length;
  return { bus, listen, events, errors, idles, missed: () => missed };
}

const NOISE: TranscribeResult = { ok: false, error: 'Не расслышал', empty: true };

describe('createPetListen: разовая запись', () => {
  it('ручная запись и тишина: молчание, только idle', () => {
    const h = setup();
    h.listen.toggle('click');
    h.listen.handleResult({ kind: 'nospeech' });
    expect(h.errors()).toEqual([]);
    expect(h.idles()).toBe(1);
    expect(h.missed()).toBe(0);
  });

  it('запись приложения и тишина: молчание, только idle', () => {
    const h = setup();
    h.bus.emit({ type: 'listen.start' });
    h.listen.handleResult({ kind: 'nospeech' });
    expect(h.errors()).toEqual([]);
    expect(h.idles()).toBe(1);
  });

  it('ручная запись, шум без слов: «Не расслышал» один раз', async () => {
    const h = setup(NOISE);
    h.listen.toggle('click');
    h.listen.handleResult({ kind: 'wav', data: new Uint8Array([1, 2]) });
    await Promise.resolve();
    await Promise.resolve();
    expect(h.errors()).toEqual(['Не расслышал']);
    expect(h.idles()).toBe(1);
    expect(h.missed()).toBe(1);
  });

  it('запись приложения, шум без слов: без сообщения', async () => {
    const h = setup(NOISE);
    h.bus.emit({ type: 'listen.start' });
    h.listen.handleResult({ kind: 'wav', data: new Uint8Array([1, 2]) });
    await Promise.resolve();
    await Promise.resolve();
    expect(h.errors()).toEqual([]);
    expect(h.idles()).toBe(1);
    expect(h.missed()).toBe(0);
  });

  it('ошибка записи: сообщение только про ручную запись', () => {
    const manual = setup();
    manual.listen.toggle('click');
    manual.listen.handleResult({ kind: 'error', message: 'Микрофон недоступен' });
    expect(manual.errors()).toEqual(['Микрофон недоступен']);
    expect(manual.idles()).toBe(1);

    const app = setup();
    app.bus.emit({ type: 'listen.start' });
    app.listen.handleResult({ kind: 'error', message: 'Микрофон недоступен' });
    expect(app.errors()).toEqual([]);
    expect(app.idles()).toBe(1);
  });

  it('cancel по-прежнему завершается событием idle', () => {
    const h = setup();
    h.listen.toggle('click');
    h.listen.handleResult({ kind: 'cancel' });
    expect(h.errors()).toEqual([]);
    expect(h.idles()).toBe(1);
  });

  it('cancel идущей записи гасит поздний результат', async () => {
    const h = setup(NOISE);
    h.listen.toggle('click');
    h.listen.cancel();
    h.listen.handleResult({ kind: 'wav', data: new Uint8Array([1, 2]) });
    await Promise.resolve();
    await Promise.resolve();
    expect(h.errors()).toEqual([]);
    expect(h.missed()).toBe(0);
  });

  it('начало ответа Тишки отменяет идущую разовую запись', () => {
    const h = setup();
    h.listen.toggle('click');
    h.bus.emit({ type: 'think.start' });
    h.listen.handleResult({ kind: 'wav', data: new Uint8Array([1, 2]) });
    expect(h.errors()).toEqual([]);
  });
});
