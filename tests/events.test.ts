import { describe, expect, it, vi } from 'vitest';
import { createEventBus } from '../src/core/events';
import type { TishkaEvent } from '../src/core/types';

const wake: TishkaEvent = { type: 'wake', source: 'name' };

describe('EventBus', () => {
  it('доставляет событие подписчику', () => {
    const bus = createEventBus();
    const listener = vi.fn();

    bus.on(listener);
    bus.emit(wake);

    expect(listener).toHaveBeenCalledWith(wake);
  });

  it('после отписки не доставляет событие', () => {
    const bus = createEventBus();
    const listener = vi.fn();

    const unsubscribe = bus.on(listener);
    unsubscribe();
    bus.emit(wake);

    expect(listener).not.toHaveBeenCalled();
  });

  it('исключение в первом подписчике не мешает второму', () => {
    const bus = createEventBus();
    const first = vi.fn(() => {
      throw new Error('boom');
    });
    const second = vi.fn();

    bus.on(first);
    bus.on(second);
    bus.emit(wake);

    expect(first).toHaveBeenCalledWith(wake);
    expect(second).toHaveBeenCalledWith(wake);
  });
});
