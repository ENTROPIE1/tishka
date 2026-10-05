import { describe, expect, it } from 'vitest';
import { createWakeState } from '../src/voice/wake-state';

describe('createWakeState', () => {
  it('свободен по умолчанию', () => {
    const state = createWakeState();
    expect(state.state()).toBe('idle');
    expect(state.busy()).toBe(false);
  });

  it('обращение без просьбы переводит в summoned', () => {
    const state = createWakeState();
    state.transition('summon');
    expect(state.state()).toBe('summoned');
  });

  it('включение разговора — listening', () => {
    const state = createWakeState();
    state.transition('listen');
    expect(state.state()).toBe('listening');
    expect(state.busy()).toBe(false);
  });

  it('фраза в ядро — busy, конец хода возвращает в listening', () => {
    const state = createWakeState();
    state.transition('listen');
    state.transition('answer');
    expect(state.state()).toBe('busy');
    expect(state.busy()).toBe(true);
    state.transition('listen');
    expect(state.state()).toBe('listening');
  });

  it('речь Тишки — speaking, конец речи — снова busy', () => {
    const state = createWakeState();
    state.transition('listen');
    state.transition('answer');
    state.transition('speak');
    expect(state.state()).toBe('speaking');
    expect(state.busy()).toBe(true);
    state.transition('speech-end');
    expect(state.state()).toBe('busy');
  });

  it('выключение разговора возвращает в idle', () => {
    const state = createWakeState();
    state.transition('listen');
    state.transition('answer');
    state.transition('disable');
    expect(state.state()).toBe('idle');
    expect(state.busy()).toBe(false);
  });

  it('неизвестный для состояния переход ничего не меняет', () => {
    const state = createWakeState();
    state.transition('speech-end');
    expect(state.state()).toBe('idle');
    state.transition('disable');
    expect(state.state()).toBe('idle');
  });
});
