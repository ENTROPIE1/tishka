import { desktopCapturer, screen } from 'electron';
import { fitSize, type CaptureResult, type ScreenTarget } from '../core/vision/look';

export interface ScreenCaptureDeps {
  hidePet(): Promise<void>;
  showPet(): void;
}

export interface ScreenCapture {
  capture(target: ScreenTarget): Promise<CaptureResult>;
}

export const HIDE_DELAY_MS = 150;

const MAX_BYTES = 4 * 1024 * 1024;
const JPEG_QUALITY = 85;
const CAPTURE_ERROR = 'Не получилось сделать снимок экрана';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// Прячет окно-питомца перед снимком (карточка и облачко скрываются вместе с окном)
// и возвращает его после, даже если снимок не удался.
export async function withHiddenPet<T>(
  deps: ScreenCaptureDeps,
  action: () => Promise<T>,
  delayMs: number = HIDE_DELAY_MS
): Promise<T> {
  await deps.hidePet();
  await delay(delayMs);
  try {
    return await action();
  } finally {
    deps.showPet();
  }
}

interface Encoded {
  png: Uint8Array;
  width: number;
  height: number;
}

function encode(image: Electron.NativeImage): Encoded | undefined {
  const size = image.getSize();
  if (size.width === 0 || size.height === 0) {
    return undefined;
  }
  const fitted = fitSize(size.width, size.height);
  const resized =
    fitted.width === size.width && fitted.height === size.height
      ? image
      : image.resize({ width: fitted.width, height: fitted.height, quality: 'best' });
  const png = resized.toPNG();
  const bytes = png.length > MAX_BYTES ? resized.toJPEG(JPEG_QUALITY) : png;
  return { png: new Uint8Array(bytes), width: fitted.width, height: fitted.height };
}

async function grab(target: ScreenTarget): Promise<CaptureResult> {
  try {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const scale = display.scaleFactor > 0 ? display.scaleFactor : 1;
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.max(1, Math.round(display.size.width * scale)),
        height: Math.max(1, Math.round(display.size.height * scale))
      }
    });
    const source = sources.find((item) => item.display_id === String(display.id)) ?? sources[0];
    if (source === undefined) {
      return { ok: false, error: CAPTURE_ERROR };
    }
    const encoded = encode(source.thumbnail);
    if (encoded === undefined) {
      return { ok: false, error: CAPTURE_ERROR };
    }
    return {
      ok: true,
      png: encoded.png,
      width: encoded.width,
      height: encoded.height,
      source: `${target === 'window' ? 'Окно' : 'Монитор'} ${encoded.width}×${encoded.height}`
    };
  } catch {
    return { ok: false, error: CAPTURE_ERROR };
  }
}

export function createScreenCapture(deps: ScreenCaptureDeps): ScreenCapture {
  return {
    // Активное чужое окно без системных вызовов не определить, поэтому и для
    // window снимается монитор, на котором сейчас указатель мыши.
    capture(target: ScreenTarget): Promise<CaptureResult> {
      return withHiddenPet(deps, () => grab(target));
    }
  };
}
