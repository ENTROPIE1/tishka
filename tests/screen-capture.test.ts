import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  desktopCapturer: { getSources: vi.fn() },
  screen: { getCursorScreenPoint: vi.fn(), getDisplayNearestPoint: vi.fn() }
}));

import { desktopCapturer, screen } from 'electron';
import { createScreenCapture, withHiddenPet, type ScreenCaptureDeps } from '../src/main/screen-capture';
import type { CaptureResult } from '../src/core/vision/look';

const mockedSources = vi.mocked(desktopCapturer.getSources);
const mockedCursor = vi.mocked(screen.getCursorScreenPoint);
const mockedDisplay = vi.mocked(screen.getDisplayNearestPoint);

interface FakeImage {
  getSize(): { width: number; height: number };
  resize(options: { width: number; height: number }): FakeImage;
  toPNG(): Buffer;
  toJPEG(quality: number): Buffer;
}

function fakeImage(
  size: { width: number; height: number },
  png: number[],
  jpeg: number[]
): FakeImage {
  const image: FakeImage = {
    getSize: () => size,
    resize: vi.fn((options: { width: number; height: number }) =>
      fakeImage(options, png, jpeg)
    ),
    toPNG: () => Buffer.from(png),
    toJPEG: () => Buffer.from(jpeg)
  };
  return image;
}

function setupDisplay(width: number, height: number): void {
  mockedCursor.mockReturnValue({ x: 10, y: 10 });
  mockedDisplay.mockReturnValue({
    id: 1,
    size: { width, height },
    scaleFactor: 1
  } as unknown as Electron.Display);
  mockedSources.mockResolvedValue([
    { display_id: '1', thumbnail: fakeImage({ width, height }, [1, 2, 3], [4, 5]) }
  ] as unknown as Awaited<ReturnType<typeof desktopCapturer.getSources>>);
}

function capture(): Promise<CaptureResult> {
  const captureDeps: ScreenCaptureDeps = { hidePet: async () => undefined, showPet: () => undefined };
  return createScreenCapture(captureDeps).capture('screen');
}

describe('снимок экрана', () => {
  it('кадр запрашивается сразу уменьшенным до 1600 по длинной стороне', async () => {
    setupDisplay(2560, 1440);

    const result = await capture();

    expect(mockedSources).toHaveBeenCalledWith({
      types: ['screen'],
      thumbnailSize: { width: 1600, height: 900 }
    });
    expect(result.ok).toBe(true);
    expect((result as { width: number }).width).toBe(1600);
    expect((result as { height: number }).height).toBe(900);
  });

  it('кадр кодируется в PNG для файла и в JPEG для модели', async () => {
    setupDisplay(2560, 1440);

    const result = await capture();

    expect(result).toMatchObject({ ok: true, png: new Uint8Array([1, 2, 3]), jpeg: new Uint8Array([4, 5]) });
  });

  it('пустая сжатая копия не отправляется, модель получает PNG', async () => {
    setupDisplay(2560, 1440);
    mockedSources.mockResolvedValue([
      { display_id: '1', thumbnail: fakeImage({ width: 2560, height: 1440 }, [1, 2, 3], []) }
    ] as unknown as Awaited<ReturnType<typeof desktopCapturer.getSources>>);

    const result = await capture();

    expect(result).toMatchObject({ ok: true, png: new Uint8Array([1, 2, 3]) });
    expect((result as { jpeg?: Uint8Array }).jpeg).toBeUndefined();
  });

  it('кадр влезает в лимит и не перекодируется зря', async () => {
    setupDisplay(1600, 900);
    const thumbnail = fakeImage({ width: 1600, height: 900 }, [7], [8]);
    const resize = vi.spyOn(thumbnail, 'resize');
    mockedSources.mockResolvedValue([
      { display_id: '1', thumbnail }
    ] as unknown as Awaited<ReturnType<typeof desktopCapturer.getSources>>);

    const result = await capture();

    expect(resize).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, png: new Uint8Array([7]), jpeg: new Uint8Array([8]) });
  });
});

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
