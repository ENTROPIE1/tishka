import type { EventBus, Reply } from '../../src/core/types';
import { STOPPED_TITLE } from '../../src/core/stopped';
import type { SttStatus, TranscribeResult } from '../../src/voice/stt-service';

export type TtsMode = 'ok' | 'rejected' | 'unreachable';

export const NOISE: TranscribeResult = { ok: false, error: 'Не расслышал', empty: true };

export interface FakeStt {
  status(): SttStatus;
  setStatus(status: SttStatus): void;
  transcribe(wav: Uint8Array, prompt?: string): Promise<TranscribeResult>;
  willHear(result: TranscribeResult | string): void;
  requests(): number;
}

// Служба распознавания: управляемое состояние и заданный текст ответа.
// Без сценария распознавание отвечает пустотой (шум).
export function createFakeStt(initial: SttStatus): FakeStt {
  let state = initial;
  const script: TranscribeResult[] = [];
  let requests = 0;
  return {
    status: () => state,
    setStatus(status: SttStatus): void {
      state = status;
    },
    willHear(result: TranscribeResult | string): void {
      script.push(typeof result === 'string' ? { ok: true, text: result } : result);
    },
    async transcribe(): Promise<TranscribeResult> {
      requests += 1;
      return script.shift() ?? NOISE;
    },
    requests: () => requests
  };
}

export interface FakeTts {
  fetch: typeof fetch;
  mode: TtsMode;
  requests(): number;
}

// Служба синтеза: успех, отказ на тексте (ошибка 500), недоступна (обрыв сети).
export function createFakeTts(mode: TtsMode): FakeTts {
  const fake: FakeTts = {
    mode,
    fetch: () => Promise.reject(new Error('не подключён')),
    requests: () => requests
  };
  let requests = 0;
  fake.fetch = (async (url: string | URL, _init?: RequestInit) => {
    requests += 1;
    if (String(url).endsWith('/health')) {
      return Response.json({ status: 'ok', engine: 'test', voice: 'test' });
    }
    if (fake.mode === 'unreachable') {
      throw new Error('ECONNREFUSED');
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
  willReply(reply: Reply): void;
  cancel(): void;
  calls(): string[];
}

// Ядро: заданный ответ; события те же, что у настоящего processUserText.
export function createFakeCore(bus: EventBus, fallback: Reply): FakeCore {
  const script: Reply[] = [];
  const calls: string[] = [];
  return {
    calls: () => calls,
    willReply(reply: Reply): void {
      script.push(reply);
    },
    async handleUserText(text: string): Promise<Reply> {
      calls.push(text);
      bus.emit({ type: 'listen.end', text });
      bus.emit({ type: 'think.start' });
      const reply = script.shift() ?? fallback;
      bus.emit({ type: 'reply', reply });
      bus.emit({ type: 'idle' });
      return reply;
    },
    // Остановка из окна ежа: уведомление и простой, как у настоящего cancel('pet').
    cancel(): void {
      bus.emit({ type: 'notify', title: STOPPED_TITLE });
      bus.emit({ type: 'idle' });
    }
  };
}
