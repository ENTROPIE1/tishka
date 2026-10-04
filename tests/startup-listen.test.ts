import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeHarness, voice } from './wake-test-helpers';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const TALK = voice({ talkByDefault: true });

// Пока служба распознавания поднимается, запись откладывается, а не падает ошибкой.
describe('wake-flow: ожидание готовности распознавания', () => {
  it('вызов при «запускается»: запись не начата, ошибки нет', () => {
    const h = makeHarness([], TALK, undefined, false);
    h.bus.emit({ type: 'wake', source: 'click' });

    expect(h.flow.isConversation()).toBe(false);
    expect(h.flow.isWaiting()).toBe(true);
    expect(h.errors).toEqual([]);
    expect(h.commands).not.toContain('conversation-on');
  });

  it('служба стала готова: запись включается один раз', () => {
    const h = makeHarness([], TALK, undefined, false);
    h.bus.emit({ type: 'wake', source: 'click' });

    h.setReady(true);
    h.flow.noteReady();
    expect(h.flow.isConversation()).toBe(true);
    expect(h.flow.isWaiting()).toBe(false);
    expect(h.commands.filter((command) => command === 'conversation-on')).toHaveLength(1);

    // Повторное уведомление о готовности ничего не меняет.
    h.flow.noteReady();
    expect(h.commands.filter((command) => command === 'conversation-on')).toHaveLength(1);
  });

  it('ёж ушёл до готовности: запись не включается', () => {
    const h = makeHarness([], TALK, undefined, false);
    h.bus.emit({ type: 'wake', source: 'click' });

    h.setVisible(false);
    h.setReady(true);
    h.flow.noteReady();

    expect(h.flow.isConversation()).toBe(false);
    expect(h.commands).not.toContain('conversation-on');
  });

  it('человек выключил микрофон до готовности: не включается', () => {
    const h = makeHarness([], TALK, undefined, false);
    h.bus.emit({ type: 'wake', source: 'click' });
    expect(h.flow.isWaiting()).toBe(true);

    h.flow.toggleConversation('pet');
    expect(h.flow.isWaiting()).toBe(false);

    h.setReady(true);
    h.flow.noteReady();
    expect(h.flow.isConversation()).toBe(false);
    expect(h.errors).toEqual([]);
  });

  it('служба упала: не включается, одна запись об ошибке', () => {
    const h = makeHarness([], TALK, undefined, false);
    h.bus.emit({ type: 'wake', source: 'click' });

    h.flow.noteFailed('Служба распознавания не запустилась: файл не найден');
    expect(h.flow.isConversation()).toBe(false);
    expect(h.flow.isWaiting()).toBe(false);
    expect(h.errors).toEqual(['Служба распознавания не запустилась: файл не найден']);

    h.flow.noteFailed('Служба распознавания не запустилась: файл не найден');
    expect(h.errors).toHaveLength(1);
  });

  it('горячая клавиша при «запускается» тоже ждёт готовности', () => {
    const h = makeHarness([], TALK, undefined, false);
    h.bus.emit({ type: 'wake', source: 'hotkey' });
    h.flow.toggleConversation('pet');
    expect(h.flow.isConversation()).toBe(false);
    expect(h.flow.isWaiting()).toBe(true);

    h.setReady(true);
    h.flow.noteReady();
    expect(h.flow.isConversation()).toBe(true);
  });

  it('без talkByDefault и без обращения ожидания нет', () => {
    const h = makeHarness([], voice({ talkByDefault: false }), undefined, false);
    h.bus.emit({ type: 'wake', source: 'trigger' });
    expect(h.flow.isWaiting()).toBe(false);
  });
});
