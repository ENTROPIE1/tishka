import { afterEach, describe, expect, it, vi } from 'vitest';
import { configWith, makeChild, okResponse, service, voice } from './stt-test-helpers';

const HELP = [
  'usage: whisper-server [options]',
  '  -sns, --suppress-nst       suppress non-speech tokens',
  '  --vad, --vad-model FNAME   enable VAD with the given model'
].join('\n');
const OLD_HELP = 'usage: whisper-server [options]\n  -m FNAME  model';

function fetchFirstDown() {
  let calls = 0;
  return vi.fn(async () => {
    calls += 1;
    if (calls === 1) {
      throw new Error('connection refused');
    }
    return okResponse();
  });
}

const BASE = ['-m', 'model.bin', '-l', 'ru', '-t', '4', '-ac', '768', '--host', '127.0.0.1', '--port', '8178'];

afterEach(() => {
  vi.useRealTimers();
});

describe('createSttService: ключи против выдумок', () => {
  it('добавляет -sns и детектор речи, состояние детектора «включён»', async () => {
    const { child } = makeChild();
    const spawn = vi.fn((_exe: string, _args: string[], _opts: unknown) => child);
    const stt = service(() => configWith('C:\\w\\whisper.exe'), spawn, fetchFirstDown(), () => true, {
      readHelp: () => HELP,
      listDir: () => ['ggml-small.bin', 'ggml-silero-v5.1.2.bin']
    });

    await expect(stt.start()).resolves.toEqual({ ok: true });
    expect(spawn.mock.calls[0][1]).toEqual([...BASE, '-sns', '--vad', '--vad-model', 'ggml-silero-v5.1.2.bin']);
    expect(stt.detector()).toBe('on');
  });

  it('старая сборка: ключей нет, детектор выключен', async () => {
    const { child } = makeChild();
    const spawn = vi.fn((_exe: string, _args: string[], _opts: unknown) => child);
    const listDir = vi.fn(() => ['ggml-silero-v5.1.2.bin']);
    const stt = service(() => configWith('C:\\w\\whisper.exe'), spawn, fetchFirstDown(), () => true, {
      readHelp: () => OLD_HELP,
      listDir
    });

    await expect(stt.start()).resolves.toEqual({ ok: true });
    expect(spawn.mock.calls[0][1]).toEqual(BASE);
    expect(listDir).not.toHaveBeenCalled();
    expect(stt.detector()).toBe('off');
  });

  it('--vad поддержан, но модели детектора нет: файл модели не найден', async () => {
    const { child } = makeChild();
    const spawn = vi.fn((_exe: string, _args: string[], _opts: unknown) => child);
    const stt = service(() => configWith('C:\\w\\whisper.exe'), spawn, fetchFirstDown(), () => true, {
      readHelp: () => HELP,
      listDir: () => ['ggml-small.bin']
    });

    await expect(stt.start()).resolves.toEqual({ ok: true });
    expect(spawn.mock.calls[0][1]).toEqual([...BASE, '-sns']);
    expect(stt.detector()).toBe('no-model');
  });

  it('stop сбрасывает состояние детектора', async () => {
    const { child } = makeChild();
    const spawn = vi.fn((_exe: string, _args: string[], _opts: unknown) => child);
    const stt = service(() => configWith('C:\\w\\whisper.exe'), spawn, fetchFirstDown(), () => true, {
      readHelp: () => HELP,
      listDir: () => ['ggml-silero-v5.bin']
    });

    await stt.start();
    expect(stt.detector()).toBe('on');
    stt.stop();
    expect(stt.detector()).toBe('off');
  });

  it('чужая служба по адресу: ключи не меняются, детектор выключен', async () => {
    const spawn = vi.fn(() => makeChild().child);
    const stt = service(
      () => voice({ stt: { exe: '', model: '', audioCtx: 768, threads: 4, mode: 'remote' } }),
      spawn,
      vi.fn(async () => okResponse()),
      () => true,
      { readHelp: () => HELP, listDir: () => ['ggml-silero.bin'] }
    );

    await expect(stt.start()).resolves.toEqual({ ok: true });
    expect(spawn).not.toHaveBeenCalled();
    expect(stt.detector()).toBe('off');
  });

  it('справка читается асинхронно: зависшая программа не блокирует запуск', async () => {
    vi.useFakeTimers();
    const hanging = makeChild();
    const helpSpawn = vi.fn((_exe: string, _args: string[], _opts: unknown) => hanging.child);
    const { child } = makeChild();
    const serviceSpawn = vi.fn((_exe: string, _args: string[], _opts: unknown) => child);
    const stt = service(() => configWith('C:\\w\\whisper.exe'), serviceSpawn, fetchFirstDown(), () => true, {
      spawnHelp: helpSpawn as unknown as typeof import('node:child_process').spawn,
      listDir: () => []
    });

    const promise = stt.start();
    await Promise.resolve();
    expect(serviceSpawn).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);

    await expect(promise).resolves.toEqual({ ok: true });
    expect(helpSpawn).toHaveBeenCalledWith('C:\\w\\whisper.exe', ['--help'], expect.anything());
    expect(hanging.kill).toHaveBeenCalled();
    expect(serviceSpawn).toHaveBeenCalledTimes(1);
    expect(serviceSpawn.mock.calls[0][1]).toEqual(BASE);
  });
});
