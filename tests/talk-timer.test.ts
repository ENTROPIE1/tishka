import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranscribeResult } from '../src/voice/stt-service';
import { flush, makeHarness, wav } from './wake-test-helpers';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('таймер разговора после ошибок распознавания', () => {
  it('«Не расслышал» посреди разговора: режим закрывается по тишине', async () => {
    const h = makeHarness([{ error: 'Не расслышал' }]);
    h.flow.enableConversation();
    await vi.advanceTimersByTimeAsync(10000);
    h.flow.handlePhrase(wav);
    await flush();
    expect(h.flow.isConversation()).toBe(true);
    await vi.advanceTimersByTimeAsync(60000);
    expect(h.flow.isConversation()).toBe(false);
  });

  it('ошибка службы (не «Не расслышал»): режим закрывается по тишине', async () => {
    const h = makeHarness([{ error: 'Служба распознавания недоступна' }]);
    h.flow.enableConversation();
    h.flow.handlePhrase(wav);
    await flush();
    expect(h.flow.isConversation()).toBe(true);
    await vi.advanceTimersByTimeAsync(30000);
    expect(h.flow.isConversation()).toBe(false);
    expect(h.hidden()).toBe(1);
  });

  it('после ошибки предупреждение о скором уходе приходит в срок', async () => {
    const h = makeHarness([{ error: 'Служба распознавания недоступна' }]);
    h.flow.enableConversation();
    h.flow.handlePhrase(wav);
    await flush();
    await vi.advanceTimersByTimeAsync(24999);
    expect(h.flow.isLeavingSoon()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.flow.isLeavingSoon()).toBe(true);
    expect(h.soonChanges).toContain(true);
  });

  it('фраза не по адресу посреди разговора заводит таймер заново', async () => {
    const h = makeHarness(['болтовня']);
    h.flow.enableConversation();
    await vi.advanceTimersByTimeAsync(20000);
    h.flow.handlePhrase(wav);
    await flush();
    await vi.advanceTimersByTimeAsync(20000);
    expect(h.flow.isConversation()).toBe(true);
    await vi.advanceTimersByTimeAsync(10000);
    expect(h.flow.isConversation()).toBe(false);
  });

  it('фраза во время ответа не заводит таймер раньше конца ответа', async () => {
    const h = makeHarness(['раз', 'два']);
    h.flow.enableConversation();
    const gate = h.deferHandle();
    h.flow.handlePhrase(wav);
    await flush();
    await vi.advanceTimersByTimeAsync(25000);
    expect(h.flow.isLeavingSoon()).toBe(false);
    h.flow.handlePhrase(wav);
    await flush();
    await vi.advanceTimersByTimeAsync(25000);
    expect(h.flow.isLeavingSoon()).toBe(false);
    expect(h.flow.isConversation()).toBe(true);
    gate.resolve();
    await flush();
    await vi.advanceTimersByTimeAsync(30000);
    expect(h.flow.isConversation()).toBe(false);
  });
});

describe('таймер разговора во время распознавания фразы', () => {
  it('пока фраза распознаётся, таймер стоит; речь заводит его заново', async () => {
    const h = makeHarness([]);
    h.flow.enableConversation();
    await vi.advanceTimersByTimeAsync(20000);
    let release: ((result: TranscribeResult) => void) | undefined;
    h.transcribe.mockImplementationOnce(
      () =>
        new Promise<TranscribeResult>((resolve) => {
          release = resolve;
        })
    );
    h.flow.handlePhrase(wav);
    await flush();
    await vi.advanceTimersByTimeAsync(15000);
    // Срок (30 с) прошёл, но распознавание ещё идёт: разговор жив и фраза не пропала.
    expect(h.flow.isConversation()).toBe(true);
    release?.({ ok: true, text: 'какие встречи сегодня' });
    await flush();
    expect(h.calls).toEqual(['какие встречи сегодня']);
    // После речи таймер заведён заново на полный срок.
    await vi.advanceTimersByTimeAsync(29000);
    expect(h.flow.isConversation()).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.flow.isConversation()).toBe(false);
  });

  it('пустой результат не продлевает таймер: отсчёт продолжается с места остановки', async () => {
    const h = makeHarness([{ error: 'Не расслышал', empty: true }]);
    h.flow.enableConversation();
    await vi.advanceTimersByTimeAsync(20000);
    let release: ((result: TranscribeResult) => void) | undefined;
    h.transcribe.mockImplementationOnce(
      () =>
        new Promise<TranscribeResult>((resolve) => {
          release = resolve;
        })
    );
    h.flow.handlePhrase(wav);
    await flush();
    await vi.advanceTimersByTimeAsync(15000);
    // Распознавание медленное: на 30-й секунде разговор ещё жив.
    expect(h.flow.isConversation()).toBe(true);
    release?.({ ok: false, error: 'Не расслышал', empty: true });
    await flush();
    // После пустого результата отсчёт продолжается: оставались 10 секунд.
    await vi.advanceTimersByTimeAsync(9000);
    expect(h.flow.isConversation()).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.flow.isConversation()).toBe(false);
  });
});
