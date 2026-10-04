import { delayOrWake, type RunToken } from './stt-run';
import { probe, PROBE_TIMEOUT_MS } from './stt-http';
import type { TimingMark } from '../main/timing-log';

export const STT_READY_TIMEOUT_MS = 30000;
const POLL_MS = 300;

export type SttReadyOutcome = 'ready' | 'cancelled' | 'failed' | 'timeout';

// Ожидание готовности службы распознавания: короткие проверки с пределом
// на общий срок. Каждая неудачная проверка попадает в журнал времени.
export async function waitSttReady(
  run: RunToken,
  url: string,
  fetchFn: typeof fetch,
  mark?: TimingMark
): Promise<SttReadyOutcome> {
  const deadline = Date.now() + STT_READY_TIMEOUT_MS;
  let attempt = 0;
  while (run.failure === undefined && !run.cancelled) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return 'timeout';
    }
    attempt += 1;
    if (await probe(fetchFn, url, Math.min(PROBE_TIMEOUT_MS, remaining))) {
      mark?.('stt.ready', { probe: true, attempt });
      return 'ready';
    }
    mark?.('stt.probe', {
      ok: false,
      attempt,
      reason: 'no-response',
      remainingMs: Math.max(0, deadline - Date.now())
    });
    const left = deadline - Date.now();
    if (left <= 0) {
      return 'timeout';
    }
    await delayOrWake(run, Math.min(POLL_MS, left));
  }
  return run.cancelled ? 'cancelled' : 'failed';
}
