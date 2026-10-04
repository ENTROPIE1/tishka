import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  desktopCapturer: { getSources: vi.fn() },
  screen: { getCursorScreenPoint: vi.fn(), getDisplayNearestPoint: vi.fn() }
}));

import { withHiddenPet, type ScreenCaptureDeps } from '../src/main/screen-capture';

function makeDeps(order: string[]): ScreenCaptureDeps {
  return {
    hidePet: async () => {
      order.push('hide');
    },
    showPet: () => {
      order.push('show');
    }
  };
}

describe('withHiddenPet', () => {
  it('прячет питомца до снимка и возвращает после', async () => {
    const order: string[] = [];
    const result = await withHiddenPet(
      makeDeps(order),
      async () => {
        order.push('capture');
        return 42;
      },
      0
    );

    expect(result).toBe(42);
    expect(order).toEqual(['hide', 'capture', 'show']);
  });

  it('возвращает питомца даже при ошибке снимка', async () => {
    const order: string[] = [];
    await expect(
      withHiddenPet(
        makeDeps(order),
        async () => {
          order.push('capture');
          throw new Error('сбой');
        },
        0
      )
    ).rejects.toThrow('сбой');

    expect(order).toEqual(['hide', 'capture', 'show']);
  });
});
