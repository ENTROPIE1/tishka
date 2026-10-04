import { describe, expect, it } from 'vitest';
import { createEventBus } from '../src/core/events';
import { createSourceBus } from '../src/main/source-bus';

describe('source bus', () => {
  it('по умолчанию источник — ёж', () => {
    const bus = createSourceBus();
    expect(bus.source()).toBe('pet');
  });

  it('во время задачи источник меняется, после — снова ёж', async () => {
    const bus = createSourceBus();
    let inside: string | undefined;
    await bus.run('chat', async () => {
      inside = bus.source();
    });
    expect(inside).toBe('chat');
    expect(bus.source()).toBe('pet');
  });

  it('источник сбрасывается, даже если задача упала', async () => {
    const bus = createSourceBus();
    await bus.run('chat', async () => {
      throw new Error('беда');
    }).catch(() => undefined);
    expect(bus.source()).toBe('pet');
  });

  it('обращения обрабатываются по очереди: источник не перебивается', async () => {
    const bus = createSourceBus();
    const seen: string[] = [];
    const first = bus.run('chat', async () => {
      await Promise.resolve();
      seen.push(bus.source());
    });
    const second = bus.run('pet', async () => {
      seen.push(bus.source());
    });
    await Promise.all([first, second]);
    expect(seen).toEqual(['chat', 'pet']);
  });

  it('события доходят до слушателей внутренней шины', () => {
    const inner = createEventBus();
    const events: string[] = [];
    inner.on((event) => events.push(event.type));
    const bus = createSourceBus(inner);
    bus.emit({ type: 'idle' });
    expect(events).toEqual(['idle']);
  });

  // Найденный дефект (Н14): озвучка реплики несёт её источник, а не текущее
  // значение шины.
  it('событие от имени источника видно слушателям, после — снова ёж', () => {
    const bus = createSourceBus();
    const seen: string[] = [];
    bus.on((event) => {
      if (event.type === 'speak.start') {
        seen.push(bus.source());
      }
    });
    bus.emitAs('chat', { type: 'speak.start', text: 'Готово' });
    expect(seen).toEqual(['chat']);
    expect(bus.source()).toBe('pet');
  });

  it('событие от имени другого источника не сбивает источник задачи', async () => {
    const bus = createSourceBus();
    let inside: string | undefined;
    await bus.run('chat', async () => {
      bus.emitAs('pet', { type: 'idle' });
      inside = bus.source();
    });
    expect(inside).toBe('chat');
    expect(bus.source()).toBe('pet');
  });
});
