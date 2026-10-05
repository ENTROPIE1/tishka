import { vi } from 'vitest';
import { createEventBus } from '../src/core/events';
import type { Config } from '../src/core/types';
import type { TranscribeResult } from '../src/voice/stt-service';
import { createStopPhrase, type StopPhrase } from '../src/voice/stop-phrase';
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
    stt: { exe: '', model: '', audioCtx: 768, threads: 4, mode: 'remote' },
    tts: { enabled: false, url: 'http://127.0.0.1:8179', volume: 1 },
    ...overrides
  };
}

export type PhraseScript = string | { error: string; empty?: boolean; unreliable?: boolean };

export interface Harness {
  flow: WakeFlow;
  bus: ReturnType<typeof createEventBus>;
  transcribe: ReturnType<typeof vi.fn>;
  calls: string[];
  history: string[];
  commands: string[];
  errors: string[];
  spoken: string[];
  captions: string[];
  stops: string[];
  hints: () => number;
  missed: () => number;
  prompts: (string | undefined)[];
  soonChanges: boolean[];
  hidden: () => number;
  deferHandle: () => { resolve: () => void };
  setReady: (value: boolean) => void;
  setVisible: (value: boolean) => void;
}

export const wav = new Uint8Array([1, 2, 3, 4]);

export function makeHarness(
  scripts: PhraseScript[],
  initial: Config['voice'] = voice(),
  memoryName?: string,
  ready = true,
  visible = true
): Harness {
  let voiceConfig = initial;
  let index = 0;
  let hiddenCount = 0;
  let blocked = false;
  let readyState = ready;
  let visibleState = visible;
  let releaseBlock: (() => void) | undefined;
  const calls: string[] = [];
  const history: string[] = [];
  const commands: string[] = [];
  const errors: string[] = [];
  const spoken: string[] = [];
  const captions: string[] = [];
  const stops: string[] = [];
  let hints = 0;
  let missed = 0;
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
      : { ok: false, error: item.error, empty: item.empty, unreliable: item.unreliable };
  });

  const core = {
    // События те же, что у настоящего processUserText: по ним видно, что ядро занято.
    handleUserText: vi.fn(async (text: string): Promise<unknown> => {
      calls.push(text);
      history.push(text);
      bus.emit({ type: 'listen.end', text });
      bus.emit({ type: 'think.start' });
      if (blocked) {
        await new Promise<void>((resolve) => {
          releaseBlock = resolve;
        });
      }
      bus.emit({ type: 'reply', reply: { say: 'ok' } });
      bus.emit({ type: 'idle' });
      return { say: 'ok' };
    })
  };

  const bus = createEventBus();
  bus.on((event) => {
    if (event.type === 'error') {
      errors.push(event.message);
    } else if (event.type === 'speak.start') {
      spoken.push(event.text);
    }
  });

  const stopPhrase: StopPhrase = createStopPhrase({
    bus,
    wakeWords: () => voiceConfig.wakeWords,
    cancel: () => stops.push('work'),
    stopSpeech: () => stops.push('speech'),
    caption: (text) => captions.push(text)
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
    isReady: () => readyState,
    isVisible: () => visibleState,
    memoryName: () => memoryName,
    onUnheard: (text) => captions.push(text),
    onUnheardHint: () => {
      hints += 1;
    },
    onMissedSpeech: () => {
      missed += 1;
    },
    onBusyPhrase: (text) => stopPhrase.phrase(text)
  });

  return {
    flow,
    bus,
    transcribe,
    calls,
    history,
    commands,
    errors,
    spoken,
    captions,
    stops,
    hints: () => hints,
    missed: () => missed,
    prompts,
    soonChanges,
    hidden: () => hiddenCount,
    setReady: (value) => {
      readyState = value;
    },
    setVisible: (value) => {
      visibleState = value;
    },
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
