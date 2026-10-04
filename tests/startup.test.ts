import { describe, expect, it, vi } from 'vitest';
import { runStartup, startupAction } from '../src/main/startup';

describe('что показать при запуске', () => {
  it('скрытый запуск вместе с Windows ничего не показывает', () => {
    expect(startupAction({ hidden: true, stand: true, hasGatewayKey: true })).toBe('nothing');
  });

  it('стенд открывается как раньше', () => {
    expect(startupAction({ hidden: false, stand: true, hasGatewayKey: false })).toBe('stand');
  });

  it('с ключом шлюза показывается ёж', () => {
    expect(startupAction({ hidden: false, stand: false, hasGatewayKey: true })).toBe('pet');
  });

  it('без ключа открывается окно «Подключения»', () => {
    expect(startupAction({ hidden: false, stand: false, hasGatewayKey: false })).toBe('chat');
  });
});

describe('runStartup', () => {
  function deps(overrides: Partial<Parameters<typeof runStartup>[0]> = {}) {
    return {
      hidden: false,
      stand: false,
      hasGatewayKey: async () => true,
      openStand: vi.fn(),
      openChat: vi.fn(),
      openPet: vi.fn(),
      ...overrides
    };
  }

  it('с ключом будит ежа и не открывает окно', async () => {
    const d = deps();
    await runStartup(d);
    expect(d.openPet).toHaveBeenCalledTimes(1);
    expect(d.openChat).not.toHaveBeenCalled();
    expect(d.openStand).not.toHaveBeenCalled();
  });

  it('без ключа открывает окно на «Подключениях»', async () => {
    const d = deps({ hasGatewayKey: async () => false });
    await runStartup(d);
    expect(d.openChat).toHaveBeenCalledWith('connections');
    expect(d.openPet).not.toHaveBeenCalled();
  });

  it('скрытый запуск не открывает ничего и не будит ежа', async () => {
    const d = deps({ hidden: true });
    await runStartup(d);
    expect(d.openPet).not.toHaveBeenCalled();
    expect(d.openChat).not.toHaveBeenCalled();
    expect(d.openStand).not.toHaveBeenCalled();
  });

  it('стенд открывает стенд', async () => {
    const d = deps({ stand: true, hasGatewayKey: async () => false });
    await runStartup(d);
    expect(d.openStand).toHaveBeenCalledTimes(1);
    expect(d.openPet).not.toHaveBeenCalled();
  });
});
