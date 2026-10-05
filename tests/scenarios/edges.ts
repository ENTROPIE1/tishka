import type { EventBus, Reply } from '../../src/core/types';
import { STOPPED_TITLE } from '../../src/core/stopped';
import { CANCELLED_REPLY } from '../../src/core/turn-queue';
import { filterHallucinations } from '../../src/voice/stt-hallucination';
import type { SttStatus, TranscribeResult } from '../../src/voice/stt-service';
import type { TalkSource } from '../../src/pet/state';

export type TtsMode = 'ok' | 'rejected' | 'unreachable';

export const NOISE: TranscribeResult = { ok: false, error: 'Не расслышал', empty: true };

export interface FakeStt {
  status(): SttStatus;
  setStatus(status: SttStatus): void;
  transcribe(wav: Uint8Array, prompt?: string): Promise<TranscribeResult>;
  willHear(result: TranscribeResult | string, holdMs?: number): void;
  requests(): number;
}

interface ScriptItem {
  result: TranscribeResult;
  holdMs: number;
}

// Служба распознавания: управляемое состояние и заданный текст ответа.
// Без сценария распознавание отвечает пустотой (шум). holdMs — сколько
// миллисекунд служба «думает» перед ответом.
export function createFakeStt(initial: SttStatus): FakeStt {
  let state = initial;
  const script: ScriptItem[] = [];
  let requests = 0;
  return {
    status: () => state,
    setStatus(status: SttStatus): void {
      state = status;
    },
    willHear(result: TranscribeResult | string, holdMs = 0): void {
      script.push({ result: typeof result === 'string' ? { ok: true, text: result } : result, holdMs });
    },
    async transcribe(): Promise<TranscribeResult> {
      requests += 1;
      const item = script.shift();
      if (item === undefined) {
        return NOISE;
      }
      if (item.holdMs > 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, item.holdMs);
        });
      }
      // Служба отдаёт текст как есть, отсев выдумок — как у createSttService.
      if (item.result.ok) {
        const filtered = filterHallucinations(item.result.text, 0);
        return filtered.dropped ? NOISE : { ok: true, text: filtered.text };
      }
      return item.result;
    },
    requests: () => requests
  };
}

export interface FakeTts {
  fetch: typeof fetch;
  mode: TtsMode;
  delayMs: number;      // сколько служба «синтезирует» один кусок
  requests(): number;
  texts(): string[];
}

// Служба синтеза: успех, отказ на тексте (ошибка 500), недоступна (обрыв сети).
export function createFakeTts(mode: TtsMode): FakeTts {
  const fake: FakeTts = {
    mode,
    delayMs: 0,
    fetch: () => Promise.reject(new Error('не подключён')),
    requests: () => requests,
    texts: () => texts
  };
  let requests = 0;
  const texts: string[] = [];
  fake.fetch = (async (url: string | URL, init?: RequestInit) => {
    requests += 1;
    if (String(url).endsWith('/health')) {
      return Response.json({ status: 'ok', engine: 'test', voice: 'test' });
    }
    const body = init?.body === undefined ? undefined : (JSON.parse(String(init.body)) as { text?: string });
    if (typeof body?.text === 'string') {
      texts.push(body.text);
    }
    if (fake.mode === 'unreachable') {
      throw new Error('ECONNREFUSED');
    }
    if (fake.delayMs > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, fake.delayMs);
      });
    }
    if (fake.mode === 'rejected') {
      return new Response('{}', { status: 500 });
    }
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  }) as unknown as typeof fetch;
  return fake;
}

export interface FakeCore {
  handleUserText(text: string): Promise<Reply>;
  willReply(reply: Reply, holdMs?: number): void;
  cancel(): void;
  calls(): string[];
}

interface ReplyScriptItem {
  reply: Reply;
  holdMs: number;   // сколько ядро «работает» до ответа
}

// Ядро: заданный ответ; события те же, что у настоящего processUserText.
// holdMs — сколько ядро занято перед ответом: ход можно остановить отменой.
export function createFakeCore(bus: EventBus, fallback: Reply): FakeCore {
  const sourceOf = (): TalkSource => (bus as EventBus & { source?(): TalkSource }).source?.() ?? 'pet';
  const script: ReplyScriptItem[] = [];
  const calls: string[] = [];
  let holding = false;
  let aborted = false;
  return {
    calls: () => calls,
    willReply(reply: Reply, holdMs = 0): void {
      script.push({ reply, holdMs });
    },
    async handleUserText(text: string): Promise<Reply> {
      calls.push(text);
      bus.emit({ type: 'listen.end', text });
      bus.emit({ type: 'think.start' });
      const item = script.shift();
      const reply = item?.reply ?? fallback;
      if (item !== undefined && item.holdMs > 0) {
        holding = true;
        aborted = false;
        await new Promise<void>((resolve) => {
          setTimeout(resolve, item.holdMs);
        });
        holding = false;
        if (aborted) {
          // Остановка: из окна чата — статус, который ёж не показывает;
          // из окна ежа — уведомление. Источник — ход, в котором шла работа.
          if (sourceOf() === 'chat') {
            bus.emit({ type: 'status', text: STOPPED_TITLE });
          } else {
            bus.emit({ type: 'notify', title: STOPPED_TITLE });
          }
          bus.emit({ type: 'idle' });
          return CANCELLED_REPLY;
        }
      }
      bus.emit({ type: 'reply', reply });
      bus.emit({ type: 'idle' });
      return reply;
    },
    // Остановка: идущий ход завершится «Остановлено» с простоем,
    // без работы — только простой.
    cancel(): void {
      if (holding) {
        aborted = true;
        return;
      }
      bus.emit({ type: 'idle' });
    }
  };
}
