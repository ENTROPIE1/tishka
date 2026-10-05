import type { Config, EventBus, Mood, MoodMark, TishkaEvent } from '../core/types';
import type { TimingMark } from './timing-log';
import type { TalkSource } from '../pet/state';
import { CANNED, CANNED_TEXTS, greetingFor } from '../voice/canned';
import { envelope } from '../voice/envelope';
import { buildMouthTrack, moodTimeMarks, MOUTH_FPS } from '../voice/lipsync';
import { createSpeechQueue, type SpeakMessage, type SpeechItem } from '../voice/speech-queue';
import { prepareForSpeech } from '../voice/speech-text';
import { createTtsClient, type TtsHealth } from '../voice/tts-client';
import { decodeWav } from '../voice/wav';

// Шина с источником обращения: озвучка реплики несёт её источник.
type SpeechBus = EventBus & {
  source?(): TalkSource;
  emitAs?(source: TalkSource, event: TishkaEvent): void;
};

export interface SpeechOutputDeps {
  bus: SpeechBus;
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
    play: (item, signal) =>
      deps.play(
        { wav: item.wav, volume: volume(), mood: item.mood, mouth: item.mouth, moods: item.moods },
        signal
      ),
    onStart: (item) => emitStart(item),
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

  // Источник реплики фиксируется в момент, когда реплика пришла; озвучка
  // начинается позже, когда шина уже вернулась к «ежу».
  function currentSource(): TalkSource {
    return deps.bus.source?.() ?? 'pet';
  }

  // Начало речи от имени источника реплики: слушатели видят её источник.
  function emitStart(item: SpeechItem): void {
    const event: TishkaEvent = { type: 'speak.start', text: item.text };
    if (item.source !== undefined && deps.bus.emitAs !== undefined) {
      deps.bus.emitAs(item.source, event);
      return;
    }
    deps.bus.emit(event);
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

  // Дорожка рта и моменты эмоций строятся из готового WAV той же раскладкой
  // букв, что ушла в синтез. Непонятный WAV — прежний режим рта по громкости.
  function trackFor(prepared: string, wav: Uint8Array, moods: MoodMark[] | undefined): {
    mouth?: SpeechItem['mouth'];
    moods?: SpeechItem['moods'];
  } {
    const decoded = decodeWav(wav);
    if (decoded === null) {
      return {};
    }
    const values = envelope(decoded.samples, decoded.sampleRate, 1000 / MOUTH_FPS);
    const mouth = buildMouthTrack(prepared, values, MOUTH_FPS);
    if (moods === undefined || moods.length === 0) {
      return { mouth };
    }
    return { mouth, moods: moodTimeMarks(prepared, moods, values, MOUTH_FPS) };
  }

  async function speak(
    text: string,
    force: boolean,
    source: TalkSource,
    moods?: MoodMark[],
    mood?: Mood
  ): Promise<void> {
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
    queue.enqueue({ text: prepared, wav, source, mood, ...trackFor(prepared, wav, moods) });
  }

  function schedule(text: string, force: boolean, moods?: MoodMark[], mood?: Mood): void {
    const source = currentSource();
    chain = chain.then(() => speak(text, force, source, moods, mood)).catch(() => undefined);
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
        schedule(event.reply.say, false, event.reply.moods, event.reply.mood);
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
