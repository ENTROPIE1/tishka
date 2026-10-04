import type { Config } from '../../core/types';

let cached: number | null = null;
let subscribed = false;

function refresh(): void {
  if (typeof window === 'undefined' || !('tishka' in window)) {
    return;
  }
  void window.tishka.config
    .get()
    .then((view: { config: Config }) => {
      cached = view.config.voice.mic.threshold;
    })
    .catch(() => undefined);
}

// Текущий калиброванный порог для одиночных записей: значение обновляется при
// первом обращении и при каждом изменении настроек.
export function micThreshold(): number | null {
  if (!subscribed && typeof window !== 'undefined' && 'tishka' in window) {
    subscribed = true;
    try {
      window.tishka.config.onChanged(refresh);
    } catch {
      subscribed = false;
    }
    refresh();
  }
  return cached;
}
