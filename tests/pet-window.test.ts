import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/core/types';

interface FakeWindow {
  visible: boolean;
  hidden: number;
  focused: number;
  bounds: { x: number; y: number; width: number; height: number };
  models: string[];
  cursor: { x: number; y: number };
  sent: { channel: string; payload: unknown }[];
}

const fake: FakeWindow = {
  visible: false,
  hidden: 0,
  focused: 0,
  bounds: { x: 0, y: 0, width: 0, height: 0 },
  models: [],
  cursor: { x: 0, y: 0 },
  sent: []
};
const listeners = new Map<string, (payload: unknown) => void>();

vi.mock('electron', () => {
  class MockBrowserWindow {
    webContents = {
      session: {
        setPermissionRequestHandler: () => undefined,
        setPermissionCheckHandler: () => undefined
      },
      on: () => undefined,
      getURL: () => 'file:///app/renderer/pet/index.html',
      setWindowOpenHandler: () => undefined,
      send: (channel: string, payload: unknown) => {
        fake.sent.push({ channel, payload });
        if (channel === 'tishka:pet:model') {
          fake.models.push((payload as { state: string }).state);
        }
        listeners.get(channel)?.(payload);
      },
      reload: () => undefined
    };
    constructor() {
      fake.bounds = { x: 2000, y: 0, width: 440, height: 884 };
    }
    setMenu(): void {}
    setAlwaysOnTop(): void {}
    setIgnoreMouseEvents(): void {}
    loadURL(): void {}
    loadFile(): void {}
    setPosition(x: number, y: number): void {
      fake.bounds = { ...fake.bounds, x, y };
    }
    setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
      fake.bounds = { ...bounds };
    }
    getBounds(): { x: number; y: number; width: number; height: number } {
      return fake.bounds;
    }
    showInactive(): void {
      fake.visible = true;
    }
    show(): void {
      fake.visible = true;
    }
    hide(): void {
      fake.visible = false;
      fake.hidden += 1;
    }
    isVisible(): boolean {
      return fake.visible;
    }
    focus(): void {
      fake.focused += 1;
    }
    isDestroyed(): boolean {
      return false;
    }
    destroy(): void {}
  }
  return {
    BrowserWindow: MockBrowserWindow,
    screen: {
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
      getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
      getCursorScreenPoint: () => fake.cursor
    },
    shell: { openExternal: () => undefined }
  };
});

import { createEventBus } from '../src/core/events';
import { createPetWindow } from '../src/main/pet-window';

function config(petMode: boolean): Config {
  return { petMode, pet: { x: null } } as unknown as Config;
}

beforeEach(() => {
  vi.useFakeTimers();
  fake.visible = false;
  fake.hidden = 0;
  fake.focused = 0;
  fake.bounds = { x: 2000, y: 0, width: 440, height: 884 };
  fake.models = [];
  fake.cursor = { x: 0, y: 0 };
  fake.sent = [];
  listeners.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('окно-питомец: уход по просьбе', () => {
  it('в режиме питомца «уходи» прячет окно, а не оставляет на экране', () => {
    const bus = createEventBus();
    const pet = createPetWindow({
      bus,
      getConfig: () => config(true),
      savePetX: async () => undefined
    });

    pet.wake('click');
    expect(fake.visible).toBe(true);

    pet.leave();
    expect(fake.models.at(-1)).toBe('leave');
    vi.advanceTimersByTime(1000);

    expect(fake.visible).toBe(false);
    expect(fake.hidden).toBeGreaterThan(0);
    pet.dispose();
  });

  it('окно создаётся один раз и при появлении только показывается', () => {
    const bus = createEventBus();
    const pet = createPetWindow({
      bus,
      getConfig: () => config(false),
      savePetX: async () => undefined
    });

    pet.wake('click');
    const visibleAfterFirst = fake.visible;
    pet.leave();
    vi.advanceTimersByTime(1000);
    pet.wake('click');

    expect(visibleAfterFirst).toBe(true);
    expect(fake.visible).toBe(true);
    pet.dispose();
  });

  it('по клавише и щелчку окно забирает фокус, по имени — нет', () => {
    const bus = createEventBus();
    const pet = createPetWindow({
      bus,
      getConfig: () => config(false),
      savePetX: async () => undefined
    });

    pet.wake('click');
    expect(fake.focused).toBeGreaterThan(0);

    const before = fake.focused;
    pet.wake('name');
    expect(fake.focused).toBe(before);
    pet.dispose();
  });

  it('при показе окна отдаёт текущее положение курсора', () => {
    const bus = createEventBus();
    const pet = createPetWindow({
      bus,
      getConfig: () => config(false),
      savePetX: async () => undefined
    });

    fake.cursor = { x: 1234, y: 321 };
    pet.wake('name');
    vi.advanceTimersByTime(1000);

    const pointer = fake.sent.filter((message) => message.channel === 'tishka:pet:pointer').at(-1);
    expect(pointer).toBeDefined();
    const point = pointer?.payload as { x: number; y: number };
    expect(point.x).toBe(1234 - fake.bounds.x);
    expect(point.y).toBe(321 - fake.bounds.y);
    pet.dispose();
  });
});
