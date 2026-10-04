import { describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => void handlers.set(channel, fn)
  }
}));

import { registerVoiceIpc } from '../src/main/ipc-voice';
import { VOICE_CHECK_CHANNEL } from '../src/main/ipc-channels';
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
    registerVoiceIpc({ stt, reloadHotkey: vi.fn(), setCalibration: vi.fn() });
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
    registerVoiceIpc({ stt, reloadHotkey: vi.fn(), setCalibration: vi.fn() });
    const check = handlers.get(VOICE_CHECK_CHANNEL);

    await expect(check?.()).resolves.toEqual({ state: 'ready', error: START_CANCELLED });
  });
});
