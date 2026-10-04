import { describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => void handlers.set(channel, fn)
  }
}));

import { registerVoiceIpc } from '../src/main/ipc-voice';
import { VOICE_CHECK_CHANNEL, VOICE_CHECK_URL_CHANNEL } from '../src/main/ipc-channels';
import { START_CANCELLED, type SttService } from '../src/voice/stt-service';

interface StartResult {
  ok: boolean;
  error?: string;
}

function sttWith(starts: Array<() => Promise<StartResult>>): SttService {
  let index = 0;
  return {
    start: vi.fn(() => starts[index++]?.() ?? Promise.resolve({ ok: true })),
    stop: vi.fn(),
    transcribe: vi.fn(),
    status: vi.fn(() => 'ready' as const),
    pid: vi.fn()
  } as unknown as SttService;
}

describe('VOICE_CHECK: вытеснённый запуск', () => {
  it('два запуска подряд — оба вызова получают итог второго', async () => {
    let resolveFirst: (value: StartResult) => void = () => undefined;
    const first = new Promise<StartResult>((resolve) => {
      resolveFirst = resolve;
    });
    const stt = sttWith([() => first, async () => ({ ok: true })]);
    registerVoiceIpc({ stt, probe: vi.fn(), reloadHotkey: vi.fn(), setCalibration: vi.fn() });
    const check = handlers.get(VOICE_CHECK_CHANNEL);
    expect(check).toBeDefined();

    const p1 = check?.();
    const p2 = check?.();
    resolveFirst({ ok: false, error: START_CANCELLED });

    await expect(p1).resolves.toEqual({ state: 'ready' });
    await expect(p2).resolves.toEqual({ state: 'ready' });
    expect(stt.start).toHaveBeenCalledTimes(2);
  });

  it('одиночный отменённый запуск возвращает ошибку', async () => {
    const stt = sttWith([async () => ({ ok: false, error: START_CANCELLED })]);
    registerVoiceIpc({ stt, probe: vi.fn(), reloadHotkey: vi.fn(), setCalibration: vi.fn() });
    const check = handlers.get(VOICE_CHECK_CHANNEL);

    await expect(check?.()).resolves.toEqual({ state: 'ready', error: START_CANCELLED });
  });
});

describe('VOICE_CHECK_URL: проверка адреса', () => {
  it('пустой адрес — причина без обращения к службе', async () => {
    const probe = vi.fn();
    const stt = sttWith([]);
    registerVoiceIpc({ stt, probe, reloadHotkey: vi.fn(), setCalibration: vi.fn() });
    const checkUrl = handlers.get(VOICE_CHECK_URL_CHANNEL);

    await expect(checkUrl?.(null, '   ')).resolves.toEqual({ ok: false, ms: 0, error: 'Адрес службы не задан' });
    expect(probe).not.toHaveBeenCalled();
  });

  it('адрес передаётся проверке без лишних пробелов', async () => {
    const probe = vi.fn(async () => ({ ok: true, ms: 7 }));
    const stt = sttWith([]);
    registerVoiceIpc({ stt, probe, reloadHotkey: vi.fn(), setCalibration: vi.fn() });
    const checkUrl = handlers.get(VOICE_CHECK_URL_CHANNEL);

    await expect(checkUrl?.(null, ' http://127.0.0.1:8178 ')).resolves.toEqual({ ok: true, ms: 7 });
    expect(probe).toHaveBeenCalledWith('http://127.0.0.1:8178');
  });
});
