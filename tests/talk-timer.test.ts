import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
