import type { Config, EventBus, TishkaEvent } from '../core/types';
import type { TimingMark } from './timing-log';
import type { TalkSource } from '../pet/state';
import { CANNED, CANNED_TEXTS, greetingFor } from '../voice/canned';
import type { SpeakMessage } from '../voice/speech-queue';
import { prepareForSpeech } from '../voice/speech-text';
import { splitForSpeech, PART_PAUSE_MS } from '../voice/speech-parts';
import { createTtsClient, type TtsHealth } from '../voice/tts-client';

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
// Не больше двух ждущих реплик: третья вытесняет самую старую.
const MAX_WAITING = 2;

interface ReplyJob {
  text: string;
  force: boolean;
  source: TalkSource;
  replyAt: number;   // момент показа ответа: от него считается первый звук
}

interface SpeechPart {
  text: string;
  wav?: Uint8Array;   // готовая запись (заготовленная фраза) — синтез не нужен
}

// Связка реплик с синтезом речи: готовит текст, ходит в службу, отдаёт звук в окно.
export function createSpeechOutput(deps: SpeechOutputDeps): SpeechOutput {
  const now = deps.now ?? ((): number => Date.now());
  const cache = new Map<string, Uint8Array>();
  const jobs: ReplyJob[] = [];
  let unavailable = false;
  let nextProbeAt = 0;
  let stopToken = 0;
  let speaking = false;
  let jobRunning = false;
  let runScheduled = false;
  let warmRunning = false;
  let currentReply: { controller: AbortController } | undefined;
  // Живые реплики: ждущие и звучащая. Пока счётчик больше нуля, прогрев ждёт.
  let liveDepth = 0;
  let liveWaiters: Array<() => void> = [];
  // Запросы к службе синтеза идут по одному, включая прогрев.
  let synthTail: Promise<void> = Promise.resolve();

  function serialize<T>(task: () => Promise<T>): Promise<T> {
    const result = synthTail.then(task);
    synthTail = result.then(() => undefined, () => undefined);
    return result;
  }

  function bumpLive(delta: number): void {
    liveDepth = Math.max(0, liveDepth + delta);
    if (liveDepth === 0) {
      const waiters = liveWaiters;
      liveWaiters = [];
      for (const waiter of waiters) {
        waiter();
      }
    }
  }

  async function waitWhileLive(): Promise<void> {
    while (liveDepth > 0) {
      await new Promise<void>((resolve) => liveWaiters.push(resolve));
    }
  }

  function halt(): void {
    stopToken += 1;
    currentReply?.controller.abort();
    const dropped = jobs.length;
    jobs.length = 0;
    if (dropped > 0) {
      bumpLive(-dropped);
    }
  }

  // Источник реплики фиксируется в момент, когда реплика пришла; озвучка
  // начинается позже, когда шина уже вернулась к «ежу».
  function currentSource(): TalkSource {
    return deps.bus.source?.() ?? 'pet';
  }

  // Начало речи от имени источника реплики: слушатели видят её источник.
  function emitStart(source: TalkSource, text: string): void {
    const event: TishkaEvent = { type: 'speak.start', text };
    if (deps.bus.emitAs !== undefined) {
      deps.bus.emitAs(source, event);
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

  // Один запрос к службе синтеза. Ключ задан только для заготовленной фразы:
  // её запись кладётся в память. Ошибка части реплику не глушит.
  async function synthesize(
    key: string | undefined,
    prepared: string,
    force: boolean,
    part: number | undefined,
    parts: number
  ): Promise<Uint8Array | undefined> {
    const cached = key !== undefined ? cache.get(key) : undefined;
    if (cached !== undefined) {
      return cached;
    }
    if (!force && unavailable && now() < nextProbeAt) {
      return undefined;
    }
    const startedAt = Date.now();
    const details: Record<string, string | number | boolean> = { chars: prepared.length };
    if (part !== undefined) {
      details['part'] = part;
      details['parts'] = parts;
    }
    deps.mark?.('tts.request.start', details);
    const result = await serialize(() => client().synthesize(prepared));
    if (!result.ok) {
      // Ошибка на конкретный текст голос не глушит: следующая часть идёт как обычно.
      if (result.kind === 'unreachable') {
        if (!unavailable) {
          unavailable = true;
          deps.bus.emit({ type: 'error', message: 'Голос недоступен, говорю текстом' });
        }
        nextProbeAt = now() + AVAILABILITY_RETRY_MS;
      }
      deps.mark?.('tts.request.end', {
        ok: false,
        chars: prepared.length,
        ...details,
        ms: Date.now() - startedAt,
        error: result.error
      });
      return undefined;
    }
    unavailable = false;
    deps.mark?.('tts.request.end', {
      ok: true,
      chars: prepared.length,
      bytes: result.wav.length,
      ...details,
      ms: Date.now() - startedAt
    });
    if (key !== undefined && CANNED_TEXTS.includes(key)) {
      cache.set(key, result.wav);
    }
    return result.wav;
  }

  function delay(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const onAbort = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  function synthPart(job: ReplyJob, part: SpeechPart, index: number, total: number): Promise<Uint8Array | undefined> {
    const key = total === 1 && CANNED_TEXTS.includes(job.text.trim()) ? job.text.trim() : undefined;
    return synthesize(key, part.text, job.force, index + 1, total);
  }

  // Реплика целиком: части синтезируются и звучат по очереди, с опережением на одну.
  async function speak(job: ReplyJob): Promise<void> {
    if (!job.force && !deps.getConfig().voice.tts.enabled) {
      return;
    }
    const trimmed = job.text.trim();
    if (trimmed === '') {
      return;
    }
    const prepared = prepareForSpeech(trimmed);
    if (prepared === '') {
      return;
    }
    const cached = cache.get(trimmed);
    const bySentence = deps.getConfig().voice.tts.bySentence !== false;
    const parts: SpeechPart[] =
      cached !== undefined
        ? [{ text: prepared, wav: cached }]
        : (bySentence ? splitForSpeech(prepared) : [prepared]).map((text) => ({ text }));
    if (parts.length === 0) {
      return;
    }
    const token = stopToken;
    const controller = new AbortController();
    currentReply = { controller };
    try {
      let nextSynth: Promise<Uint8Array | undefined> | undefined;
      let started = false;
      for (let index = 0; index < parts.length; index += 1) {
        if (token !== stopToken) {
          return;
        }
        const part = parts[index] as SpeechPart;
        let wav: Uint8Array | undefined;
        if (part.wav !== undefined) {
          wav = part.wav;
        } else if (nextSynth !== undefined) {
          wav = await nextSynth;
        } else {
          wav = await synthPart(job, part, index, parts.length);
        }
        nextSynth = undefined;
        if (token !== stopToken) {
          return;
        }
        const following = parts[index + 1];
        if (following !== undefined && following.wav === undefined) {
          nextSynth = synthPart(job, following, index + 1, parts.length);
        }
        if (wav === undefined) {
          continue;   // ошибка части: пропускаем, следующая звучит
        }
        if (index > 0) {
          await delay(PART_PAUSE_MS, controller.signal);
          if (token !== stopToken) {
            return;
          }
        }
        if (!started) {
          started = true;
          speaking = true;
          emitStart(job.source, prepared);
          deps.mark?.('speech.first', { ms: now() - job.replyAt, parts: parts.length });
        }
        await deps.play({ wav, volume: volume() }, controller.signal);
        if (token !== stopToken) {
          return;
        }
      }
    } finally {
      if (currentReply?.controller === controller) {
        currentReply = undefined;
      }
    }
  }

  async function runJobs(): Promise<void> {
    jobRunning = true;
    try {
      while (jobs.length > 0) {
        const job = jobs.shift() as ReplyJob;
        await speak(job);
        bumpLive(-1);
      }
    } finally {
      jobRunning = false;
      if (speaking) {
        speaking = false;
        deps.bus.emit({ type: 'speak.end' });
      }
    }
  }

  function schedule(text: string, force: boolean): void {
    const job: ReplyJob = { text, force, source: currentSource(), replyAt: now() };
    jobs.push(job);
    bumpLive(1);
    while (jobs.length > MAX_WAITING) {
      jobs.shift();
      bumpLive(-1);
    }
    // Запуск откладывается на микрозадачу: реплика, поставленная вслед за
    // событием в том же кадре (приветствие и «слушаю»), успевает быть снята
    // до начала звука, как и раньше.
    if (!jobRunning && !runScheduled) {
      runScheduled = true;
      void Promise.resolve().then(() => {
        runScheduled = false;
        return runJobs();
      });
    }
  }

  async function runWarm(): Promise<void> {
    if (warmRunning) {
      return;
    }
    warmRunning = true;
    try {
      for (const text of CANNED_TEXTS) {
        if (cache.has(text)) {
          continue;
        }
        if (!deps.getConfig().voice.tts.enabled) {
          return;
        }
        await waitWhileLive();
        if (cache.has(text)) {
          continue;
        }
        const prepared = prepareForSpeech(text);
        if (prepared === '') {
          continue;
        }
        await synthesize(text, prepared, false, undefined, 1);
      }
    } finally {
      warmRunning = false;
    }
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
      void runWarm().catch(() => undefined);
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
