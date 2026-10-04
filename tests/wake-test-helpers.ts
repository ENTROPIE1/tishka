import { vi } from 'vitest';
import { createEventBus } from '../src/core/events';
import type { Config } from '../src/core/types';
import type { TranscribeResult } from '../src/voice/stt-service';
import { createWakeFlow, type WakeFlow } from '../src/voice/wake-flow';

export function voice(overrides: Partial<Config['voice']> = {}): Config['voice'] {
  return {
    hotkey: 'Control+Alt+Space',
    wakeWords: ['тишка'],
    wakeEnabled: true,
    talkByDefault: false,
    talkTimeoutSec: 30,
    sensitivity: 'normal',
    mic: { threshold: null, noise: null, speech: null, calibratedAt: null },
    sttUrl: 'http://127.0.0.1:8178',
    stt: { exe: '', model: '', audioCtx: 768, threads: 4 },
    tts: { enabled: false, url: 'http://127.0.0.1:8179', volume: 1 },
    ...overrides
  };
}

export type PhraseScript = string | { error: string; empty?: boolean };

export interface Harness {
  flow: WakeFlow;
  bus: ReturnType<typeof createEventBus>;
  transcribe: ReturnType<typeof vi.fn>;
  calls: string[];
  history: string[];
  commands: string[];
  errors: string[];
  prompts: (string | undefined)[];
  soonChanges: boolean[];
  hidden: () => number;
  deferHandle: () => { resolve: () => void };
}

export const wav = new Uint8Array([1, 2, 3, 4]);

export function makeHarness(
  scripts: PhraseScript[],
  initial: Config['voice'] = voice(),
  memoryName?: string,
  ready = true
): Harness {
  let voiceConfig = initial;
  let index = 0;
  let hiddenCount = 0;
  let blocked = false;
  let releaseBlock: (() => void) | undefined;
  const calls: string[] = [];
  const history: string[] = [];
  const commands: string[] = [];
  const errors: string[] = [];
  const prompts: (string | undefined)[] = [];
  const soonChanges: boolean[] = [];

  const transcribe = vi.fn(async (_data: Uint8Array, prompt?: string): Promise<TranscribeResult> => {
    prompts.push(prompt);
    const item = scripts[index];
    index += 1;
    if (item === undefined) {
      return { ok: false, error: 'Не расслышал' };
    }
    return typeof item === 'string'
      ? { ok: true, text: item }
      : { ok: false, error: item.error, empty: item.empty };
  });

  const core = {
    handleUserText: vi.fn(async (text: string): Promise<unknown> => {
      calls.push(text);
      history.push(text);
      if (blocked) {
        await new Promise<void>((resolve) => {
          releaseBlock = resolve;
        });
      }
      return { say: 'ok' };
    })
  };

  const bus = createEventBus();
  bus.on((event) => {
    if (event.type === 'error') {
      errors.push(event.message);
    }
  });

  const flow = createWakeFlow({
    getVoice: () => voiceConfig,
    stt: { transcribe: transcribe as unknown as (data: Uint8Array, prompt?: string) => Promise<TranscribeResult> },
    core,
    bus,
    sendCommand: (command) => commands.push(command),
    hide: () => {
      hiddenCount += 1;
    },
    onSoonChange: () => soonChanges.push(flow.isLeavingSoon()),
    isReady: () => ready,
    memoryName: () => memoryName
  });

  return {
    flow,
    bus,
    transcribe,
    calls,
    history,
    commands,
    errors,
    prompts,
    soonChanges,
    hidden: () => hiddenCount,
    deferHandle: () => {
      blocked = true;
      return {
        resolve: () => {
          blocked = false;
          releaseBlock?.();
          releaseBlock = undefined;
        }
      };
    }
  };
}

export async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await vi.advanceTimersByTimeAsync(0);
  }
}
