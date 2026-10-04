import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, makeHarness, voice, wav } from './wake-test-helpers';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const TALK = voice({ talkByDefault: true });

describe('talkByDefault', () => {
  it('одно имя без просьбы включает разговор и не просит обычную запись', async () => {
    const h = makeHarness(['Тишка'], TALK);
    h.flow.handlePhrase(wav);
    await flush();

    expect(h.flow.isConversation()).toBe(true);
    expect(h.flow.conversationOwner()).toBe('pet');
    expect(h.commands).toContain('conversation-on');
    expect(h.commands).not.toContain('listen');
  });

  it('имя с просьбой включает разговор', async () => {
    const h = makeHarness(['Тишка, который час'], TALK);
    h.flow.handlePhrase(wav);
    await flush();

    expect(h.calls).toEqual(['который час']);
    expect(h.flow.isConversation()).toBe(true);
  });

  it('щелчок по ёжику включает разговор', () => {
    const h = makeHarness([], TALK);
    h.bus.emit({ type: 'wake', source: 'click' });

    expect(h.flow.isConversation()).toBe(true);
  });

  it('уведомление разговор не включает', () => {
    const h = makeHarness([], TALK);
    h.bus.emit({ type: 'wake', source: 'trigger' });

    expect(h.flow.isConversation()).toBe(false);
  });

  it('если служба не готова — разговор не включается и ошибки нет', () => {
    const h = makeHarness([], TALK, undefined, false);
    h.bus.emit({ type: 'wake', source: 'click' });

    expect(h.flow.isConversation()).toBe(false);
    expect(h.errors).toEqual([]);
  });

  it('выключенный значок молчит до конца появления, затем слушает снова', () => {
    const h = makeHarness([], TALK);
    h.bus.emit({ type: 'wake', source: 'click' });
    expect(h.flow.isConversation()).toBe(true);

    h.flow.toggleConversation('pet');
    expect(h.flow.isConversation()).toBe(false);

    h.flow.toggleConversation('pet');
    expect(h.flow.isConversation()).toBe(false);

    h.bus.emit({ type: 'wake', source: 'click' });
    expect(h.flow.isConversation()).toBe(true);
  });
});
