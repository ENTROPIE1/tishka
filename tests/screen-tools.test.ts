import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  readdir: vi.fn(),
  unlink: vi.fn()
}));

import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createEventBus } from '../src/core/events';
import { registerScreenTools, pruneShots, type ScreenToolsDeps } from '../src/core/tools/screen';
import { createToolRegistry } from '../src/core/tools/registry';
import type { CaptureResult } from '../src/core/vision/look';

const mockedMkdir = vi.mocked(mkdir);
const mockedWriteFile = vi.mocked(writeFile);
const mockedReaddir = vi.mocked(readdir);
const mockedUnlink = vi.mocked(unlink);

const NOW = new Date('2026-10-04T15:30:05');
const PNG = new Uint8Array([1, 2, 3]);

function okCapture(): CaptureResult {
  return { ok: true, png: PNG, width: 1920, height: 1080, source: 'Монитор' };
}

function makeDeps(overrides: Partial<ScreenToolsDeps> = {}): ScreenToolsDeps {
  return {
    capture: vi.fn(async () => okCapture()),
    look: vi.fn(async () => ({ ok: true, content: 'на экране таблица' })),
    screenshotsDir: 'C:/tishka-data/screenshots',
    now: () => NOW,
    events: createEventBus(),
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedMkdir.mockResolvedValue(undefined as never);
  mockedWriteFile.mockResolvedValue(undefined as never);
  mockedReaddir.mockResolvedValue([] as never);
  mockedUnlink.mockResolvedValue(undefined as never);
});

describe('registerScreenTools', () => {
  it('при выключенной настройке инструменты не регистрируются', () => {
    const registry = createToolRegistry(createEventBus());
    registerScreenTools(registry, makeDeps(), false);

    expect(registry.list()).toEqual([]);
  });

  it('при включённой настройке screen_look и screen_shot на месте', () => {
    const registry = createToolRegistry(createEventBus());
    registerScreenTools(registry, makeDeps(), true);

    const names = registry.list().map((def) => def.name);
    expect(names).toContain('screen_look');
    expect(names).toContain('screen_shot');
  });

  it('screen_look передаёт вопрос и возвращает ответ модели', async () => {
    const look = vi.fn(async () => ({ ok: true, content: 'ошибка про доступ' }));
    const registry = createToolRegistry(createEventBus());
    registerScreenTools(registry, makeDeps({ look }), true);

    const result = await registry.call('screen_look', { question: 'что за ошибка?' });

    expect(result).toEqual({ ok: true, content: 'ошибка про доступ' });
    expect(look).toHaveBeenCalledWith('что за ошибка?', 'screen');
  });

  it('при снимке в облачке появляется «Смотрю на экран…»', async () => {
    const events = createEventBus();
    const seen: string[] = [];
    events.on((event) => {
      if (event.type === 'status') {
        seen.push(event.text);
      }
    });
    const registry = createToolRegistry(events);
    registerScreenTools(registry, makeDeps({ events }), true);

    await registry.call('screen_look', {});

    expect(seen).toContain('Смотрю на экран…');
  });

  it('screen_shot сохраняет файл и возвращает карточку image', async () => {
    const registry = createToolRegistry(createEventBus());
    registerScreenTools(registry, makeDeps(), true);

    const result = await registry.call('screen_shot', {});

    expect(result.ok).toBe(true);
    expect(mockedMkdir).toHaveBeenCalledWith('C:/tishka-data/screenshots', { recursive: true });
    const savedPath = join('C:/tishka-data/screenshots', '2026-10-04_15-30-05.png');
    expect(mockedWriteFile).toHaveBeenCalledWith(savedPath, PNG);
    const data = result.data as { path: string; panel: { kind: string; path: string } };
    expect(data.path).toBe(savedPath);
    expect(data.panel).toEqual({ kind: 'image', title: 'Снимок экрана', path: savedPath });
  });

  it('ошибка снимка возвращается понятной строкой', async () => {
    const registry = createToolRegistry(createEventBus());
    registerScreenTools(
      registry,
      makeDeps({ capture: async () => ({ ok: false, error: 'Не получилось сделать снимок экрана' }) }),
      true
    );

    const result = await registry.call('screen_shot', {});

    expect(result).toEqual({ ok: false, content: '', error: 'Не получилось сделать снимок экрана' });
  });
});

describe('pruneShots', () => {
  it('удаляет старые снимки сверх 50', async () => {
    const names: string[] = [];
    for (let index = 0; index < 51; index += 1) {
      const day = String(index + 1).padStart(2, '0');
      names.push(`2026-09-${day}_10-00-00.png`);
    }
    names.push('заметка.txt');
    mockedReaddir.mockResolvedValueOnce(names as never);

    await pruneShots('C:/shots');

    expect(mockedUnlink).toHaveBeenCalledTimes(1);
    expect(mockedUnlink).toHaveBeenCalledWith(join('C:/shots', '2026-09-01_10-00-00.png'));
  });

  it('когда снимков меньше 50, ничего не удаляет', async () => {
    mockedReaddir.mockResolvedValueOnce(['2026-09-01_10-00-00.png'] as never);

    await pruneShots('C:/shots');

    expect(mockedUnlink).not.toHaveBeenCalled();
  });
});
