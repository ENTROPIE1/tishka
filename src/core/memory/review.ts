import type { EventBus, Panel } from '../types';
import type { MemoryStore } from './store';

const DAY_MS = 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const MAX_PER_REVIEW = 10;
const REVIEW_SAY = 'Проверим, что я помню?';

export interface MemoryReviewerDeps {
  store: MemoryStore;
  events: EventBus;
  now: () => Date;
}

export interface MemoryReviewer {
  start(): Promise<void>;
  stop(): void;
  tick(): Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function reviewPanel(store: MemoryStore): Panel {
  const items = store.due().slice(0, MAX_PER_REVIEW).map((record) => {
    const item: { title: string; subtitle?: string } = { title: record.text };
    if (record.tags.length > 0) {
      item.subtitle = record.tags.join(', ');
    }
    return item;
  });
  return { kind: 'list', title: REVIEW_SAY, items };
}

export function createMemoryReviewer(deps: MemoryReviewerDeps): MemoryReviewer {
  let timer: ReturnType<typeof setInterval> | undefined;

  async function tick(): Promise<void> {
    const now = deps.now();
    const last = deps.store.lastReview();
    if (last !== undefined && now.getTime() - Date.parse(last) < DAY_MS) {
      return;
    }
    if (deps.store.due().length === 0) {
      return;
    }
    await deps.store.setLastReview(now.toISOString());
    deps.events.emit({ type: 'wake', source: 'trigger' });
    deps.events.emit({ type: 'notify', title: REVIEW_SAY });
    deps.events.emit({ type: 'reply', reply: { say: REVIEW_SAY, show: reviewPanel(deps.store) } });
  }

  async function guardedTick(): Promise<void> {
    try {
      await tick();
    } catch (error) {
      deps.events.emit({ type: 'error', message: errorMessage(error) });
    }
  }

  return {
    async start(): Promise<void> {
      if (timer !== undefined) {
        return;
      }
      await guardedTick();
      timer = setInterval(() => {
        void guardedTick();
      }, CHECK_INTERVAL_MS);
    },

    stop(): void {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    },

    tick(): Promise<void> {
      return guardedTick();
    }
  };
}
