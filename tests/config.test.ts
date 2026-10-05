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
    expect(config.llm.api).toBe('chat');
    expect(config.voice.hotkey).toBe('Control+Alt+Space');
    expect(config.voice.wakeWords).toEqual(['тишка']);
    expect(config.voice.sttUrl).toBe('http://127.0.0.1:8178');
    expect(config.voice.stt).toEqual({ exe: '', model: '', audioCtx: 768, threads: 4, mode: 'remote' });
    expect(config.voice.tts).toEqual({ enabled: false, url: 'http://127.0.0.1:8179', volume: 1, bySentence: true });
    expect(config.mcpServers).toEqual([]);
    expect(config.petMode).toBe(false);
    expect(config.web).toEqual({ enabled: true });
    expect(config.persona).toEqual({ fyr: 'sometimes', character: 'hedgehog' });
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

  it('читает переключатель чтения страниц', async () => {
    mockedReadFile.mockResolvedValueOnce(JSON.stringify({ web: { enabled: false } }) as never);
    const config = await loadConfig(dir);
    expect(config.web).toEqual({ enabled: false });
  });

  it('старые настройки без запасных моделей читаются как пустые', async () => {
    mockedReadFile.mockResolvedValueOnce(
      JSON.stringify({ llm: { model: 'Своя модель', visionModel: 'Своя картинка' } }) as never
    );
    const config = await loadConfig(dir);
    expect(config.llm.fallbackModel).toBe('');
    expect(config.llm.visionFallbackModel).toBe('');
  });

  it('запасные модели читаются и обрезаются пробелами', async () => {
    mockedReadFile.mockResolvedValueOnce(
      JSON.stringify({
        llm: { fallbackModel: ' DKS-Backup ', visionFallbackModel: ' DKS-Vision-Backup ' }
      }) as never
    );
    const config = await loadConfig(dir);
    expect(config.llm.fallbackModel).toBe('DKS-Backup');
    expect(config.llm.visionFallbackModel).toBe('DKS-Vision-Backup');
  });

  it('без поля llm.api формат читается как chat', async () => {
    mockedReadFile.mockResolvedValueOnce(JSON.stringify({ llm: { model: 'Своя модель' } }) as never);
    const config = await loadConfig(dir);
    expect(config.llm.api).toBe('chat');
  });

  it('неизвестное значение llm.api читается как chat', async () => {
    mockedReadFile.mockResolvedValueOnce(JSON.stringify({ llm: { api: 'giga' } }) as never);
    const config = await loadConfig(dir);
    expect(config.llm.api).toBe('chat');
  });

  it('формат responses сохраняется', async () => {
    mockedReadFile.mockResolvedValueOnce(JSON.stringify({ llm: { api: 'responses' } }) as never);
    const config = await loadConfig(dir);
    expect(config.llm.api).toBe('responses');
  });

  it('старые настройки без mode: заполненные пути — местная служба', async () => {
    mockedReadFile.mockResolvedValueOnce(
      JSON.stringify({ voice: { stt: { exe: 'C:\\w\\whisper.exe', model: 'C:\\w\\model.bin' } } }) as never
    );
    const config = await loadConfig(dir);
    expect(config.voice.stt.mode).toBe('local');
  });

  it('старые настройки без mode: пустые пути — готовая служба по адресу', async () => {
    mockedReadFile.mockResolvedValueOnce(
      JSON.stringify({ voice: { sttUrl: 'http://127.0.0.1:8178' } }) as never
    );
    const config = await loadConfig(dir);
    expect(config.voice.stt.mode).toBe('remote');
  });

  it('новое поле mode сохраняется, заполненные пути его не перебивают', async () => {
    mockedReadFile.mockResolvedValueOnce(
      JSON.stringify({
        voice: { stt: { exe: 'C:\\w\\whisper.exe', model: 'C:\\w\\model.bin', mode: 'remote' } }
      }) as never
    );
    const config = await loadConfig(dir);
    expect(config.voice.stt.mode).toBe('remote');
    expect(config.voice.stt.exe).toBe('C:\\w\\whisper.exe');
  });

  it('неизвестное значение mode выводится из путей', async () => {
    mockedReadFile.mockResolvedValueOnce(
      JSON.stringify({ voice: { stt: { exe: 'C:\\w\\whisper.exe', model: 'C:\\w\\model.bin', mode: 'cloud' } } }) as never
    );
    const config = await loadConfig(dir);
    expect(config.voice.stt.mode).toBe('local');
  });

  it('старые настройки без персонажа — прежний ёж', async () => {
    mockedReadFile.mockResolvedValueOnce(JSON.stringify({ persona: { fyr: 'often' } }) as never);
    const config = await loadConfig(dir);
    expect(config.persona.character).toBe('hedgehog');
    expect(config.persona.fyr).toBe('often');
  });

  it('выбранный персонаж сохраняется и читается', async () => {
    mockedReadFile.mockResolvedValueOnce(
      JSON.stringify({ persona: { fyr: 'sometimes', character: 'tishka' } }) as never
    );
    const config = await loadConfig(dir);
    expect(config.persona.character).toBe('tishka');
  });

  it('неизвестное значение персонажа читается как прежний ёж', async () => {
    mockedReadFile.mockResolvedValueOnce(JSON.stringify({ persona: { character: 'robot' } }) as never);
    const config = await loadConfig(dir);
    expect(config.persona.character).toBe('hedgehog');
  });

  it('читает tts и игнорирует старое поле ttsEngine', async () => {    mockedReadFile.mockResolvedValueOnce(
      JSON.stringify({ voice: { ttsEngine: 'silero', tts: { enabled: true, url: 'http://1.2.3.4:9000', volume: 0.5 } } }) as never
    );
    const config = await loadConfig(dir);
    expect(config.voice.tts).toEqual({ enabled: true, url: 'http://1.2.3.4:9000', volume: 0.5, bySentence: true });
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
