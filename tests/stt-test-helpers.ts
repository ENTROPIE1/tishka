import type { ChildProcess } from 'node:child_process';
import { vi } from 'vitest';
import type { Config } from '../src/core/types';
import { createSttService } from '../src/voice/stt-service';

export type HandlerMap = Record<string, (...args: unknown[]) => void>;

export function voice(overrides: Partial<Config['voice']> = {}): Config['voice'] {
  return {
    hotkey: 'Control+Alt+Space',
    wakeWords: ['тишка'],
    wakeEnabled: false,
    talkByDefault: true,
    talkTimeoutSec: 30,
    sensitivity: 'normal',
    mic: { threshold: null, noise: null, speech: null, calibratedAt: null },
    sttUrl: 'http://127.0.0.1:8178',
    stt: { exe: '', model: '', audioCtx: 768, threads: 4 },
    tts: { enabled: false, url: 'http://127.0.0.1:8179', volume: 1 },
    ...overrides
  };
}

export function configWith(exe: string, model = 'model.bin'): Config['voice'] {
  return voice({ stt: { exe, model, audioCtx: 768, threads: 4 } });
}

export interface FakeChild {
  child: ChildProcess;
  kill: ReturnType<typeof vi.fn>;
  handlers: HandlerMap;
  stderrHandlers: HandlerMap;
}

export function makeChild(pid?: number): FakeChild {
  const handlers: HandlerMap = {};
  const stderrHandlers: HandlerMap = {};
  const on = vi.fn((event: string, cb: (...args: unknown[]) => void) => {
    handlers[event] = cb;
  });
  const stderrOn = vi.fn((event: string, cb: (...args: unknown[]) => void) => {
    stderrHandlers[event] = cb;
  });
  const kill = vi.fn();
  const child = { kill, on, pid, stderr: { on: stderrOn } } as unknown as ChildProcess;
  return { child, kill, handlers, stderrHandlers };
}

export function okResponse(body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

export function service(
  getConfig: () => Config['voice'],
  spawn: ReturnType<typeof vi.fn>,
  fetchMock: ReturnType<typeof vi.fn>,
  fileExists: (path: string) => boolean = () => true
) {
  return createSttService({
    getConfig,
    spawn: spawn as unknown as typeof import('node:child_process').spawn,
    fetch: fetchMock as unknown as typeof fetch,
    fileExists
  });
}
