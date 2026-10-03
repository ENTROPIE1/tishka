import type { EventBus, TishkaEvent } from './types';

export function createEventBus(): EventBus {
  const listeners = new Set<(event: TishkaEvent) => void>();

  return {
    emit(event: TishkaEvent): void {
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[tishka] listener failed: ${message}`);
        }
      }
    },
    on(listener: (event: TishkaEvent) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
}
