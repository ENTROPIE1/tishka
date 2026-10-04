import type { Config, EventBus } from '../core/types';
import type { TimingMark } from './timing-log';
import { CANNED, CANNED_TEXTS, greetingFor } from '../voice/canned';
import { createSpeechQueue, type SpeakMessage } from '../voice/speech-queue';
import { prepareForSpeech } from '../voice/speech-text';
import { createTtsClient, type TtsHealth } from '../voice/tts-client';

export interface SpeechOutputDeps {
  bus: EventBus;
  getConfig(): Config;
  play(message: SpeakMessage, signal: AbortSignal): Promise<void>;
  isReady?(): boolean;   // служба распознавания готова: «слушаю» не обещаем зря
  fetch?: typeof fetch;
  now?: () => number;
  mark?: TimingMark;
}

export interface SpeechOutput {
  health(): Promise<TtsHealth>;
  sayExample(): void;
  warm(): void;
  stopSpeaking(): void;
  dispose(): void;
}

const AVAILABILITY_RETRY_MS = 15000;
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

  async function wavFor(text: string, prepared: string, force: boolean): Promise<Uint8Array | undefined> {
    const cached = cache.get(text);
    if (cached !== undefined) {
      return cached;
    }
    if (!force && unavailable && now() < nextProbeAt) {
      return undefined;
    }
    const startedAt = Date.now();
    deps.mark?.('tts.request.start', { chars: prepared.length });
    const result = await client().synthesize(prepared);
    if (!result.ok) {
      // Ошибка на конкретный текст голос не глушит: следующая реплика синтезируется как обычно.
      if (result.kind === 'unreachable') {
        if (!unavailable) {
          unavailable = true;
          deps.bus.emit({ type: 'error', message: 'Голос недоступен, говорю текстом' });
        }
        nextProbeAt = now() + AVAILABILITY_RETRY_MS;
      }
      deps.mark?.('tts.request.end', { ok: false, chars: prepared.length, ms: Date.now() - startedAt, error: result.error });
      return undefined;
    }
    unavailable = false;
    deps.mark?.('tts.request.end', {
      ok: true,
      chars: prepared.length,
      bytes: result.wav.length,
      ms: Date.now() - startedAt
    });
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
    const wav = await wavFor(trimmed, prepared, force);
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
        // Приветствие «Слушаю» уместно, только когда человек позвал Тишку сам
        // и запись действительно возможна; уведомление по триггеру не в счёт.
        if (event.source !== 'trigger') {
          schedule(greetingFor(deps.isReady?.() !== false), false);
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
          void wavFor(text, prepared, false).catch(() => undefined);
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
