import { afterEach, describe, expect, it, vi } from 'vitest';
import { REMOTE_UNREACHABLE } from '../src/voice/stt-service';
import { configWith, makeChild, okResponse, service, voice } from './stt-test-helpers';

afterEach(() => {
  vi.useRealTimers();
});

describe('createSttService.start', () => {
  it('запускает программу с ожидаемыми аргументами и становится ready', async () => {
    const exe = 'C:\\tools\\whisper\\whisper-server.exe';
    const model = 'C:\\tools\\whisper\\model.bin';
    const { child } = makeChild();
    const spawn = vi.fn((_exe: string, _args: string[], _opts: unknown) => child);
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error('connection refused');
      }
      return okResponse();
    });
    const stt = service(() => configWith(exe, model), spawn, fetchMock);

    await expect(stt.start()).resolves.toEqual({ ok: true });

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0][0]).toBe(exe);
    expect(spawn.mock.calls[0][1]).toEqual([
      '-m', model, '-l', 'ru', '-t', '4', '-ac', '768', '--host', '127.0.0.1', '--port', '8178'
    ]);
    expect(spawn.mock.calls[0][2]).toMatchObject({ cwd: 'C:\\tools\\whisper' });
    expect(stt.status()).toBe('ready');
  });

  it('путь с кириллицей — ошибка, программа не запускается', async () => {
    const spawn = vi.fn(() => makeChild().child);
    const fetchMock = vi.fn(async () => okResponse());
    const stt = service(() => configWith('C:\\инструменты\\whisper.exe'), spawn, fetchMock);

    const result = await stt.start();

    expect(result).toEqual({ ok: false, error: 'Путь к службе распознавания должен быть без кириллицы' });
    expect(spawn).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stt.status()).toBe('error');
  });

  it('пустой путь и служба не отвечает — сразу off, без ожидания', async () => {
    const spawn = vi.fn(() => makeChild().child);
    const fetchMock = vi.fn(async () => {
      throw new Error('connection refused');
    });
    const stt = service(() => voice(), spawn, fetchMock);

    await expect(stt.start()).resolves.toEqual({ ok: false, error: REMOTE_UNREACHABLE });
    expect(spawn).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(stt.status()).toBe('off');
  });

  it('режим remote: даже с заполненными путями процесс не запускается', async () => {
    const spawn = vi.fn(() => makeChild().child);
    const fetchMock = vi.fn(async () => okResponse());
    const stt = service(
      () => voice({ stt: { exe: 'C:\\w\\whisper.exe', model: 'model.bin', audioCtx: 768, threads: 4, mode: 'remote' } }),
      spawn,
      fetchMock
    );

    await expect(stt.start()).resolves.toEqual({ ok: true });
    expect(spawn).not.toHaveBeenCalled();
    expect(stt.status()).toBe('ready');
  });

  it('режим remote: служба не отвечает — off и причина', async () => {
    const spawn = vi.fn(() => makeChild().child);
    const fetchMock = vi.fn(async () => {
      throw new Error('connection refused');
    });
    const stt = service(
      () => voice({ stt: { exe: 'C:\\w\\whisper.exe', model: 'model.bin', audioCtx: 768, threads: 4, mode: 'remote' } }),
      spawn,
      fetchMock
    );

    await expect(stt.start()).resolves.toEqual({ ok: false, error: REMOTE_UNREACHABLE });
    expect(spawn).not.toHaveBeenCalled();
    expect(stt.status()).toBe('off');
  });

  it('если служба не ответила за отведённое время — ошибка, процесс остановлен', async () => {
    vi.useFakeTimers();
    const { child, kill } = makeChild();
    const spawn = vi.fn(() => child);
    const fetchMock = vi.fn(async () => {
      throw new Error('connection refused');
    });
    const stt = service(() => configWith('C:\\w\\whisper.exe'), spawn, fetchMock);

    const promise = stt.start();
    await vi.advanceTimersByTimeAsync(31000);
    const result = await promise;

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(kill).toHaveBeenCalled();
    expect(stt.status()).toBe('error');
  });

  it('нет файла модели — ошибка с именем файла, spawn не вызывался', async () => {
    const exe = 'C:\\w\\whisper.exe';
    const model = 'C:\\w\\model.bin';
    const spawn = vi.fn(() => makeChild().child);
    const fetchMock = vi.fn(async () => {
      throw new Error('connection refused');
    });
    const stt = service(() => configWith(exe, model), spawn, fetchMock, (path) => path === exe);

    const result = await stt.start();

    expect(result).toEqual({ ok: false, error: `Не найден файл модели: ${model}` });
    expect(spawn).not.toHaveBeenCalled();
    expect(stt.status()).toBe('error');
  });

  it('адрес уже отвечает — spawn не вызывался, состояние ready', async () => {
    const spawn = vi.fn(() => makeChild().child);
    const fetchMock = vi.fn(async () => okResponse());
    const stt = service(() => configWith('C:\\w\\whisper.exe'), spawn, fetchMock);

    await expect(stt.start()).resolves.toEqual({ ok: true });
    expect(spawn).not.toHaveBeenCalled();
    expect(stt.status()).toBe('ready');
  });

  it('ранний выход программы — ошибка сразу, с кодом выхода и хвостом вывода', async () => {
    const { child, handlers, stderrHandlers } = makeChild();
    const spawn = vi.fn(() => child);
    const fetchMock = vi.fn(async () => {
      throw new Error('connection refused');
    });
    const stt = service(() => configWith('C:\\w\\whisper.exe'), spawn, fetchMock);

    const promise = stt.start();
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    stderrHandlers.data('cannot load model\n');
    handlers.exit(1);
    const result = await promise;

    expect(result.ok).toBe(false);
    expect(result.error).toContain('код выхода 1');
    expect(result.error).toContain('cannot load model');
    expect(stt.status()).toBe('error');
  });

  it('гонка: второй запуск отменяет первый, чужой процесс не остановлен', async () => {
    let firstResolve: (value: Response) => void = () => undefined;
    const first = new Promise<Response>((resolve) => {
      firstResolve = resolve;
    });
    let calls = 0;
    const fetchMock = vi.fn(() => {
      calls += 1;
      if (calls === 1) {
        return first;
      }
      if (calls === 2) {
        return Promise.reject(new Error('connection refused'));
      }
      return Promise.resolve(okResponse());
    });
    const { child, kill } = makeChild();
    const spawn = vi.fn(() => child);
    let current = voice();
    const stt = service(() => current, spawn, fetchMock);

    const firstStart = stt.start();
    current = configWith('C:\\w\\whisper.exe');
    const secondStart = stt.start();
    await expect(secondStart).resolves.toEqual({ ok: true });
    firstResolve(okResponse());

    await expect(firstStart).resolves.toEqual({ ok: false, error: 'Запуск отменён' });
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(kill).not.toHaveBeenCalled();
    expect(stt.status()).toBe('ready');
  });

  it('stop во время ожидания — ожидание прекращено, процесс остановлен', async () => {
    const { child, kill } = makeChild();
    const spawn = vi.fn(() => child);
    const fetchMock = vi.fn(async () => {
      throw new Error('connection refused');
    });
    const stt = service(() => configWith('C:\\w\\whisper.exe'), spawn, fetchMock);

    const promise = stt.start();
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    stt.stop();

    await expect(promise).resolves.toEqual({ ok: false, error: 'Запуск отменён' });
    expect(kill).toHaveBeenCalled();
    expect(stt.status()).toBe('off');
  });

  it('pid возвращает идентификатор запущенного процесса, после остановки — undefined', async () => {
    const { child } = makeChild(4242);
    const spawn = vi.fn(() => child);
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error('connection refused');
      }
      return okResponse();
    });
    const stt = service(() => configWith('C:\\w\\whisper.exe'), spawn, fetchMock);

    expect(stt.pid()).toBeUndefined();
    await expect(stt.start()).resolves.toEqual({ ok: true });
    expect(stt.pid()).toBe(4242);

    stt.stop();
    expect(stt.pid()).toBeUndefined();
  });

  it('pid чужой службы — undefined', async () => {
    const spawn = vi.fn(() => makeChild(4242).child);
    const fetchMock = vi.fn(async () => okResponse());
    const stt = service(() => voice(), spawn, fetchMock);

    await expect(stt.start()).resolves.toEqual({ ok: true });
    expect(spawn).not.toHaveBeenCalled();
    expect(stt.pid()).toBeUndefined();
  });
});
