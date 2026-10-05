// Готовит из одного снимка два варианта для scripts/check-screen-speed.ts:
// «до» — PNG с длинной стороной 1920, «после» — PNG и JPEG со стороной 1600.
// Запуск: npx electron scripts/encode-shot.js <файл-снимка|capture> <каталог>
// Итог размеров и времени кодирования пишется в <каталог>/result.json.
const { app, desktopCapturer, nativeImage, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const OLD_SIDE = 1920;   // прежний предел длинной стороны
const NEW_SIDE = 1600;   // новый предел
const JPEG_QUALITY = 85; // как в приложении

function fitSize(width, height, maxSide) {
  const longest = Math.max(width, height);
  if (longest <= maxSide || longest === 0) {
    return { width, height };
  }
  const scale = maxSide / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

// Снимок в полном разрешении: из него дальше делаются оба варианта,
// чтобы сравнение шло по одному и тому же кадру.
async function captureFull() {
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
    throw new Error('Снимок экрана не получился');
  }
  return source.thumbnail;
}

function resized(image, size, fitted) {
  if (fitted.width === size.width && fitted.height === size.height) {
    return image;
  }
  return image.resize({ width: fitted.width, height: fitted.height, quality: 'best' });
}

async function main() {
  const input = process.argv[2];
  const outDir = process.argv[3];
  if (!input || !outDir) {
    console.error('Использование: npx electron scripts/encode-shot.js <файл-снимка|capture> <каталог>');
    app.exit(1);
    return;
  }
  const captureStarted = Date.now();
  const image = input === 'capture' ? await captureFull() : nativeImage.createFromPath(input);
  const captureMs = Date.now() - captureStarted;
  if (image.isEmpty()) {
    console.error('Картинка пуста или не прочитана');
    app.exit(1);
    return;
  }
  fs.mkdirSync(outDir, { recursive: true });
  const size = image.getSize();

  const oldFit = fitSize(size.width, size.height, OLD_SIDE);
  const oldStarted = Date.now();
  const oldPng = resized(image, size, oldFit).toPNG();
  const oldMs = Date.now() - oldStarted;

  const newFit = fitSize(size.width, size.height, NEW_SIDE);
  const newStarted = Date.now();
  const newImage = resized(image, size, newFit);
  const newPng = newImage.toPNG();
  const newJpeg = newImage.toJPEG(JPEG_QUALITY);
  const newMs = Date.now() - newStarted;

  const oldPath = path.join(outDir, 'old.png');
  const pngPath = path.join(outDir, 'new.png');
  const jpegPath = path.join(outDir, 'new.jpg');
  fs.writeFileSync(oldPath, oldPng);
  fs.writeFileSync(pngPath, newPng);
  fs.writeFileSync(jpegPath, newJpeg);

  const result = {
    source: size,
    captureMs,
    old: { path: oldPath, width: oldFit.width, height: oldFit.height, bytes: oldPng.length, ms: oldMs },
    new: {
      pngPath,
      jpegPath,
      width: newFit.width,
      height: newFit.height,
      pngBytes: newPng.length,
      jpegBytes: newJpeg.length,
      ms: newMs
    }
  };
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2));
  app.exit(0);
}

app.whenReady().then(main).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  app.exit(1);
});
