import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
  mkdir: vi.fn()
}));

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { defaultConfig, loadConfig, saveConfig } from '../src/core/config';

const mockedReadFile = vi.mocked(readFile);
const mockedWriteFile = vi.mocked(writeFile);
const mockedRename = vi.mocked(rename);
const mockedMkdir = vi.mocked(mkdir);

const dir = 'C:/tishka-data';

beforeEach(() => {
  vi.clearAllMocks();
  mockedMkdir.mockResolvedValue(undefined as never);
  mockedWriteFile.mockResolvedValue(undefined as never);
  mockedRename.mockResolvedValue(undefined as never);
});

describe('defaultConfig', () => {
  it('содержит значения по умолчанию', () => {
    const config = defaultConfig();
    expect(config.llm.baseUrl).toBe('https://llm.dks.lanit.ru/v1');
    expect(config.llm.model).toBe('DKS-Lynx');
    expect(config.llm.visionModel).toBe('DKS-Vision');
    expect(config.voice.hotkey).toBe('Control+Alt+Space');
    expect(config.voice.wakeWords).toEqual(['тишка']);
    expect(config.voice.sttUrl).toBe('http://127.0.0.1:8178');
    expect(config.voice.stt).toEqual({ exe: '', model: '', audioCtx: 768, threads: 4 });
    expect(config.voice.ttsEngine).toBe('none');
    expect(config.mcpServers).toEqual([]);
    expect(config.petMode).toBe(false);
  });
});

describe('loadConfig', () => {
  it('при отсутствии файла возвращает значения по умолчанию', async () => {
    mockedReadFile.mockRejectedValueOnce(new Error('ENOENT') as never);
    await expect(loadConfig(dir)).resolves.toEqual(defaultConfig());
  });

  it('при повреждённом файле возвращает значения по умолчанию', async () => {
    mockedReadFile.mockResolvedValueOnce('{ это не json' as never);
    await expect(loadConfig(dir)).resolves.toEqual(defaultConfig());
  });

  it('дополняет частичный файл значениями по умолчанию', async () => {
    mockedReadFile.mockResolvedValueOnce(
      JSON.stringify({ llm: { model: 'Своя модель' }, petMode: true }) as never
    );
    const config = await loadConfig(dir);
    expect(config.llm.model).toBe('Своя модель');
    expect(config.llm.baseUrl).toBe(defaultConfig().llm.baseUrl);
    expect(config.petMode).toBe(true);
  });
});

describe('saveConfig', () => {
  it('пишет во временный файл и переименовывает его', async () => {
    const config = defaultConfig();
    await saveConfig(dir, config);

    const target = join(dir, 'config.json');
    const temporary = `${target}.tmp`;

    expect(mockedMkdir).toHaveBeenCalledWith(dir, { recursive: true });
    expect(mockedWriteFile).toHaveBeenCalledTimes(1);
    expect(mockedWriteFile.mock.calls[0][0]).toBe(temporary);
    expect(mockedWriteFile.mock.calls[0][1]).toBe(JSON.stringify(config, null, 2));
    expect(mockedRename).toHaveBeenCalledWith(temporary, target);
  });
});
