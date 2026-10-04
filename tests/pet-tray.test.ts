import { afterEach, describe, expect, it, vi } from 'vitest';

const { clickHandlers } = vi.hoisted(() => ({ clickHandlers: [] as Array<() => void> }));

vi.mock('electron', () => {
  class MockTray {
    on(event: string, listener: () => void): this {
      if (event === 'click') {
        clickHandlers.push(listener);
      }
      return this;
    }
    setContextMenu(): void {}
    setToolTip(): void {}
    destroy(): void {}
  }
  return {
    Tray: MockTray,
    Menu: { buildFromTemplate: () => ({ getMenuItemById: () => null }) },
    nativeImage: { createFromDataURL: () => ({}) }
  };
});

import { createPetTray, type PetTrayDeps } from '../src/main/pet-tray';

function makeDeps(): PetTrayDeps {
  return {
    wake: vi.fn(),
    openChat: vi.fn(),
    openSettings: vi.fn(),
    openStand: vi.fn(),
    getPetMode: () => true,
    setPetMode: vi.fn(),
    getWakeEnabled: () => true,
    setWakeEnabled: vi.fn(),
    isWakeListening: () => false,
    quit: vi.fn()
  };
}

afterEach(() => {
  clickHandlers.length = 0;
  vi.restoreAllMocks();
});

describe('значок в области уведомлений', () => {
  it('левый щелчок открывает окно чата', () => {
    const deps = makeDeps();
    createPetTray(deps);

    expect(clickHandlers).toHaveLength(1);
    clickHandlers[0]();

    expect(deps.openChat).toHaveBeenCalledOnce();
    expect(deps.openSettings).not.toHaveBeenCalled();
  });
});
