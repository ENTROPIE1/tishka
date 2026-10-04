import { describe, expect, it } from 'vitest';
import type { PetState } from '../src/pet/state';
import { composerBusy, composerCollapsed } from '../src/renderer/pet/composer-state';

describe('состояние строки ввода', () => {
  it('«занят» только пока ёж думает или работает', () => {
    expect(composerBusy('thinking')).toBe(true);
    expect(composerBusy('working')).toBe(true);
  });

  it('«занят» снимается после reply, error и idle', () => {
    const afterReply: PetState = 'talking';
    const afterError: PetState = 'confused';
    const afterIdle: PetState = 'idle';

    expect(composerBusy(afterReply)).toBe(false);
    expect(composerBusy(afterError)).toBe(false);
    expect(composerBusy(afterIdle)).toBe(false);
  });

  it('строка свёрнута только во сне и при уведомлении', () => {
    expect(composerCollapsed('sleep')).toBe(true);
    expect(composerCollapsed('notify')).toBe(true);
    expect(composerCollapsed('thinking')).toBe(false);
    expect(composerCollapsed('idle')).toBe(false);
  });
});
