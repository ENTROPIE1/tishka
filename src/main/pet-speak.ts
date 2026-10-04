import type { Config, EventBus } from '../core/types';
import { CANNED, CANNED_TEXTS } from '../voice/canned';
import { createSpeechQueue, type SpeakMessage } from '../voice/speech-queue';
import { prepareForSpeech } from '../voice/speech-text';
import { createTtsClient, type TtsHealth } from '../voice/tts-client';

export interface SpeechOutputDeps {
  bus: EventBus;
  getConfig(): Config;
  play(message: SpeakMessage, signal: AbortSignal): Promise<void>;
  fetch?: typeof fetch;
  now?: () => number;
}

export interface SpeechOutput {
  health(): Promise<TtsHealth>;
  sayExample(): void;
  warm(): void;
  stopSpeaking(): void;
  dispose(): void;
}

const AVAILABILITY_RETRY_MS = 60000;
const EXAMPLE_TEXT = 'Привет, я Тишка. Сейчас девять часов тридцать минут.';
const STOP_WORD = /(^|[\s.,!?])стоп(?=[\s.,!?]|$)/i;

// Связка реплик с синтезом речи: готовит текст, ходит в службу, отдаёт звук в окно.
export function createSpeechOutput(deps: SpeechOutputDeps): SpeechOutput {
  const now = deps.now ?? ((): number => Date.now());
  const cache = new Map<string, Uint8Array>();
  const queue = createSpeechQueue({
    play: (item, signal) => deps.play({ wav: item.wav, volume: volume() }, signal),
    onStart: (text) => deps.bus.emit({ type: 'speak.start', text }),
    onEnd: () => deps.bus.emit({ type: 'speak.end' })
  });
  let unavailable = false;
  let nextProbeAt = 0;
  let reported = false;
  let stopToken = 0;
  let chain: Promise<void> = Promise.resolve();

  function halt(): void {
    stopToken += 1;
    queue.stop();
  }

  function volume(): number {
    const value = deps.getConfig().voice.tts.volume;
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
  }

  function client() {
    return createTtsClient({ url: deps.getConfig().voice.tts.url, fetch: deps.fetch });
  }

  async function wavFor(text: string, prepared: string): Promise<Uint8Array | undefined> {
    const cached = cache.get(text);
    if (cached !== undefined) {
      return cached;
    }
    if (unavailable && now() < nextProbeAt) {
      return undefined;
    }
    const result = await client().synthesize(prepared);
    if (!result.ok) {
      unavailable = true;
      nextProbeAt = now() + AVAILABILITY_RETRY_MS;
      if (!reported) {
        reported = true;
        deps.bus.emit({ type: 'error', message: 'Голос недоступен, говорю текстом' });
      }
      return undefined;
    }
    unavailable = false;
    if (CANNED_TEXTS.includes(text)) {
      cache.set(text, result.wav);
    }
    return result.wav;
  }

  async function speak(text: string, force: boolean): Promise<void> {
    if (!force && !deps.getConfig().voice.tts.enabled) {
      return;
    }
    const trimmed = text.trim();
    if (trimmed === '') {
      return;
    }
    const prepared = prepareForSpeech(trimmed);
    if (prepared === '') {
      return;
    }
    const token = stopToken;
    const wav = await wavFor(trimmed, prepared);
    if (wav === undefined || token !== stopToken) {
      return;
    }
    queue.enqueue({ text: prepared, wav });
  }

  function schedule(text: string, force: boolean): void {
    chain = chain.then(() => speak(text, force)).catch(() => undefined);
  }

  const unsubscribe = deps.bus.on((event) => {
    switch (event.type) {
      case 'reply': {
        if (event.reply.say === CANNED.thinking) {
          return;
        }
        if (event.reply.say === CANNED.farewell) {
          halt();
        }
        schedule(event.reply.say, false);
        return;
      }
      case 'wake':
        // Приветствие «Слушаю» уместно, только когда человек позвал Тишку сам;
        // уведомление по триггеру не включает прослушивание.
        if (event.source !== 'trigger') {
          schedule(CANNED.greeting, false);
        }
        return;
      case 'listen.start':
        halt();
        return;
      case 'listen.end':
        if (STOP_WORD.test(event.text)) {
          halt();
        }
        return;
      default:
        return;
    }
  });

  return {
    health: () => client().health(),
    sayExample(): void {
      schedule(EXAMPLE_TEXT, true);
    },
    // Заготовленные фразы синтезируются заранее и лежат в памяти: появление без ожидания.
    warm(): void {
      if (!deps.getConfig().voice.tts.enabled) {
        return;
      }
      for (const text of CANNED_TEXTS) {
        const prepared = prepareForSpeech(text);
        if (prepared !== '') {
          void wavFor(text, prepared).catch(() => undefined);
        }
      }
    },
    stopSpeaking(): void {
      halt();
    },
    dispose(): void {
      unsubscribe();
      halt();
    }
  };
}
