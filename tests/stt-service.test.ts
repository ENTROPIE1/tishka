import type { ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/core/types';
import { createSttService } from '../src/voice/stt-service';

type Voice = Config['voice'];

function voice(overrides: Partial<Voice> = {}): Voice {
  return {
    hotkey: 'Control+Alt+Space',
    wakeWords: ['тишка'],
    sttUrl: 'http://127.0.0.1:8178',
    stt: { exe: '', model: '', audioCtx: 768, threads: 4 },
    ttsEngine: 'none',
    ...overrides
  };
}

function fakeChild(): { kill: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> } & ChildProcess {
  const child = { kill: vi.fn(), on: vi.fn() };
  return child as unknown as { kill: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> } & ChildProcess;
}

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createSttService', () => {
  it('запускает программу с ожидаемыми аргументами и становится ready', async () => {
    const exe = 'C:\\tools\\whisper\\whisper-server.exe';
    const model = 'C:\\tools\\whisper\\model.bin';
    const spawn = vi.fn((_exe: string, _args: string[], _opts: unknown) => fakeChild());
    const fetchMock = vi.fn(async () => okResponse({}));
    const service = createSttService({
      getConfig: () => voice({ stt: { exe, model, audioCtx: 768, threads: 4 } }),
      spawn: spawn as unknown as typeof import('node:child_process').spawn,
      fetch: fetchMock as unknown as typeof fetch
    });

    await expect(service.start()).resolves.toEqual({ ok: true });

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0][0]).toBe(exe);
    expect(spawn.mock.calls[0][1]).toEqual([
      '-m', model, '-l', 'ru', '-t', '4', '-ac', '768', '--host', '127.0.0.1', '--port', '8178'
    ]);
    expect(spawn.mock.calls[0][2]).toMatchObject({ cwd: 'C:\\tools\\whisper' });
    expect(service.status()).toBe('ready');
  });

  it('путь с кириллицей — ошибка, программа не запускается', async () => {
    const spawn = vi.fn((_exe: string, _args: string[], _opts: unknown) => fakeChild());
    const fetchMock = vi.fn(async () => okResponse({}));
    const service = createSttService({
      getConfig: () => voice({ stt: { exe: 'C:\\инструменты\\whisper.exe', model: 'm.bin', audioCtx: 768, threads: 4 } }),
      spawn: spawn as unknown as typeof import('node:child_process').spawn,
      fetch: fetchMock as unknown as typeof fetch
    });

    const result = await service.start();

    expect(result).toEqual({ ok: false, error: 'Путь к службе распознавания должен быть без кириллицы' });
    expect(spawn).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(service.status()).toBe('error');
  });

  it('если служба не ответила за отведённое время — ошибка, процесс остановлен', async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    const spawn = vi.fn(() => child);
    const fetchMock = vi.fn(async () => {
      throw new Error('connection refused');
    });
    const service = createSttService({
      getConfig: () => voice({ stt: { exe: 'C:\\w\\whisper.exe', model: 'm.bin', audioCtx: 768, threads: 4 } }),
      spawn: spawn as unknown as typeof import('node:child_process').spawn,
      fetch: fetchMock as unknown as typeof fetch
    });

    const promise = service.start();
    await vi.advanceTimersByTimeAsync(31000);
    const result = await promise;

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(child.kill).toHaveBeenCalled();
    expect(service.status()).toBe('error');
  });

  it('пустой exe не запускает программу, но распознавание доступно', async () => {
    const spawn = vi.fn(() => fakeChild());
    const fetchMock = vi.fn(async () => okResponse({}));
    const service = createSttService({
      getConfig: () => voice(),
      spawn: spawn as unknown as typeof import('node:child_process').spawn,
      fetch: fetchMock as unknown as typeof fetch
    });

    await expect(service.start()).resolves.toEqual({ ok: true });
    expect(spawn).not.toHaveBeenCalled();
    expect(service.status()).toBe('ready');
  });

  it('transcribe отправляет форму с файлом и возвращает очищенный текст', async () => {
    const fetchMock = vi.fn(async () => okResponse({ text: ' [музыка]  Тишка,\n привет ' }));
    const service = createSttService({
      getConfig: () => voice(),
      fetch: fetchMock as unknown as typeof fetch
    });

    const result = await service.transcribe(new Uint8Array([1, 2, 3, 4]));

    expect(result).toEqual({ ok: true, text: 'Тишка, привет' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8178/inference');
    expect(init.method).toBe('POST');
    const form = init.body as FormData;
    expect(form.get('response_format')).toBe('json');
    const file = form.get('file');
    expect(file).toBeInstanceOf(Blob);
    expect((file as File).name).toBe('audio.wav');
  });

  it('пустой ответ — ошибка «Не расслышал»', async () => {
    const fetchMock = vi.fn(async () => okResponse({ text: '   ' }));
    const service = createSttService({
      getConfig: () => voice(),
      fetch: fetchMock as unknown as typeof fetch
    });

    await expect(service.transcribe(new Uint8Array([1]))).resolves.toEqual({
      ok: false,
      error: 'Не расслышал'
    });
  });

  it('сбой сети даёт понятную ошибку', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network down');
    });
    const service = createSttService({
      getConfig: () => voice(),
      fetch: fetchMock as unknown as typeof fetch
    });

    await expect(service.transcribe(new Uint8Array([1]))).resolves.toEqual({
      ok: false,
      error: 'Не удалось обратиться к службе распознавания'
    });
  });
});
