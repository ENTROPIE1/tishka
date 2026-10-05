import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSilenceTimer } from '../src/voice/silence-timer';

interface Mount {
  timer: ReturnType<typeof createSilenceTimer>;
  fired: number[];
  soonValues: boolean[];
}

function mount(totalMs = 30000): Mount {
  const fired: number[] = [];
  const soonValues: boolean[] = [];
  const timer = createSilenceTimer({
    totalMs: () => totalMs,
    fire: () => fired.push(1),
    onSoonChange: () => soonValues.push(timer.soon())
  });
  return { timer, fired, soonValues };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('таймер тишины разговора', () => {
  it('полный срок заводится заново и сообщает о скором уходе', async () => {
    const h = mount(30000);
    h.timer.arm();
    await vi.advanceTimersByTimeAsync(24999);
    expect(h.timer.soon()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.soonValues).toContain(true);
    expect(h.fired).toEqual([]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.fired).toHaveLength(1);
  });

  it('пауза останавливает отсчёт, возобновление продолжает его с места остановки', async () => {
    const h = mount(30000);
    h.timer.arm();
    await vi.advanceTimersByTimeAsync(20000);
    h.timer.pause();
    await vi.advanceTimersByTimeAsync(60000);
    expect(h.fired).toEqual([]);
    h.timer.resume();
    await vi.advanceTimersByTimeAsync(9999);
    expect(h.fired).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.fired).toHaveLength(1);
  });

  it('пустой результат не продлевает срок: отсчёт идёт с места остановки', async () => {
    const h = mount(30000);
    h.timer.arm();
    await vi.advanceTimersByTimeAsync(25000);
    h.timer.pause();
    await vi.advanceTimersByTimeAsync(10000);
    expect(h.fired).toEqual([]);
    h.timer.resume();
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.fired).toHaveLength(1);
  });

  it('пауза сохраняет признак «скоро уйду»', async () => {
    const h = mount(30000);
    h.timer.arm();
    await vi.advanceTimersByTimeAsync(26000);
    expect(h.timer.soon()).toBe(true);
    h.timer.pause();
    expect(h.timer.soon()).toBe(true);
    await vi.advanceTimersByTimeAsync(60000);
    expect(h.fired).toEqual([]);
    h.timer.resume();
    await vi.advanceTimersByTimeAsync(3999);
    expect(h.fired).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.fired).toHaveLength(1);
  });

  it('вне отсчёта пауза и возобновление ничего не делают', () => {
    const h = mount(30000);
    h.timer.pause();
    h.timer.resume();
    expect(h.fired).toEqual([]);
    h.timer.resume();
    expect(h.timer.soon()).toBe(false);
  });

  it('clear отменяет уход, arm заводит полный срок заново', async () => {
    const h = mount(30000);
    h.timer.arm();
    await vi.advanceTimersByTimeAsync(20000);
    h.timer.clear();
    await vi.advanceTimersByTimeAsync(60000);
    expect(h.fired).toEqual([]);
    expect(h.timer.soon()).toBe(false);
    h.timer.arm();
    await vi.advanceTimersByTimeAsync(29999);
    expect(h.fired).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.fired).toHaveLength(1);
  });

  it('arm снимает паузу и признак скорого ухода', async () => {
    const h = mount(30000);
    h.timer.arm();
    await vi.advanceTimersByTimeAsync(26000);
    h.timer.pause();
    h.timer.arm();
    expect(h.timer.soon()).toBe(false);
    await vi.advanceTimersByTimeAsync(25000);
    expect(h.timer.soon()).toBe(true);
    expect(h.fired).toEqual([]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.fired).toHaveLength(1);
  });
});
