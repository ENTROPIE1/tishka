// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Config } from '../src/core/types';
import {
  THRESHOLD_MAX,
  THRESHOLD_MIN,
  createThresholdControl
} from '../src/renderer/settings/threshold-control';

const EMPTY_MIC: Config['voice']['mic'] = { threshold: null, noise: null, speech: null, calibratedAt: null };

function mount(mic: Config['voice']['mic']): {
  element: HTMLElement;
  range: HTMLInputElement;
  label: HTMLElement;
  saved: Array<Config['voice']['mic']>;
} {
  const saved: Array<Config['voice']['mic']> = [];
  const control = createThresholdControl({
    getMic: () => mic,
    saveMic: async (next) => {
      saved.push(next);
    }
  });
  const range = control.element.querySelector<HTMLInputElement>('input')!;
  const label = control.element.querySelector<HTMLElement>('.threshold-value')!;
  return { element: control.element, range, label, saved };
}

describe('ползунок порога громкости', () => {
  it('без порога в настройках работает значение по умолчанию', () => {
    const h = mount({ ...EMPTY_MIC });
    expect(h.label.textContent).toContain('0,004');
    expect(Number(h.range.value)).toBeGreaterThan(0);
    expect(h.element.querySelector<HTMLElement>('.threshold-level')).not.toBeNull();
    expect(h.element.querySelector<HTMLElement>('.level-mark')).not.toBeNull();
  });

  it('сохранённый порог показывается на шкале', () => {
    const h = mount({ ...EMPTY_MIC, threshold: 0.02 });
    expect(h.label.textContent).toContain('0,02');
  });

  it('сдвиг ползунка сохраняет порог и не трогает калибровку', async () => {
    const mic: Config['voice']['mic'] = {
      threshold: 0.004,
      noise: 0.002,
      speech: 0.05,
      calibratedAt: '2026-10-01T09:00:00.000Z'
    };
    const h = mount(mic);
    h.range.value = h.range.max;
    h.range.dispatchEvent(new Event('change'));
    await Promise.resolve();
    expect(h.saved).toHaveLength(1);
    expect(h.saved[0].threshold).toBeCloseTo(THRESHOLD_MAX, 5);
    expect(h.saved[0].noise).toBe(0.002);
    expect(h.saved[0].speech).toBe(0.05);
    expect(h.saved[0].calibratedAt).toBe('2026-10-01T09:00:00.000Z');
  });

  it('сброс калибровки (порог null) возвращается на умолчание при refresh', () => {
    const state: Config['voice']['mic'] = { ...EMPTY_MIC, threshold: 0.05 };
    const control = createThresholdControl({
      getMic: () => state,
      saveMic: async (next) => {
        Object.assign(state, next);
      }
    });
    const label = control.element.querySelector<HTMLElement>('.threshold-value')!;
    expect(label.textContent).toContain('0,05');
    Object.assign(state, EMPTY_MIC);
    control.refresh();
    expect(label.textContent).toContain('0,004');
  });

  it('границы шкалы охватывают рабочие значения', () => {
    expect(THRESHOLD_MIN).toBeLessThan(0.004);
    expect(THRESHOLD_MAX).toBeGreaterThan(0.02);
  });
});
