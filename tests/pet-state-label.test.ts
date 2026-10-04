import { describe, expect, it } from 'vitest';
import { stateLabel } from '../src/renderer/pet/state-label';

describe('stateLabel: ожидание готовности распознавания', () => {
  it('состояние «слушает» показывается, только когда запись идёт', () => {
    expect(stateLabel('listening')).toBe('слушает');
    expect(stateLabel('listening', true)).toBe('ждёт');
  });

  it('прочие состояния ожиданием не подменяются', () => {
    expect(stateLabel('thinking', true)).toBe('думает');
    expect(stateLabel('idle', true)).toBe('ждёт');
  });

  it('во время приветствия подпись — «говорит», даже пока служба не готова', () => {
    expect(stateLabel('listening', false, true)).toBe('говорит');
    expect(stateLabel('listening', true, true)).toBe('говорит');
  });
});
