import type { Config } from '../core/types';
import { START_CANCELLED, type SttService } from '../voice/stt-service';

export function voiceRestartNeeded(previous: Config, next: Config): boolean {
  const before = previous.voice;
  const after = next.voice;
  return (
    before.stt.mode !== after.stt.mode ||
    before.sttUrl !== after.sttUrl ||
    before.stt.exe !== after.stt.exe ||
    before.stt.model !== after.stt.model
  );
}

// Куда сообщить об исходе перезапуска: служба поднялась или не поднялась.
// Так отложенное включение записи завершается так же, как при первом запуске.
export interface VoiceRestartDeps {
  onReady?(): void;
  onFailed?(message?: string): void;
}

// Смена варианта или адреса применяется сразу: прежняя служба останавливается,
// новая запускается. В режиме remote запуск ограничивается проверкой адреса,
// чужой процесс при этом не трогается.
export function restartVoiceIfNeeded(
  stt: SttService,
  previous: Config,
  next: Config,
  deps: VoiceRestartDeps = {}
): boolean {
  if (!voiceRestartNeeded(previous, next)) {
    return false;
  }
  stt.stop();
  void stt
    .start()
    .then((result) => {
      if (result.ok) {
        deps.onReady?.();
      } else if (result.error !== START_CANCELLED) {
        deps.onFailed?.(result.error);
      }
    })
    .catch(() => deps.onFailed?.());
  return true;
}
