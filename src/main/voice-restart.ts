import type { Config } from '../core/types';
import type { SttService } from '../voice/stt-service';

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

// Смена варианта или адреса применяется сразу: прежняя служба останавливается,
// новая запускается. В режиме remote запуск ограничивается проверкой адреса,
// чужой процесс при этом не трогается.
export function restartVoiceIfNeeded(stt: SttService, previous: Config, next: Config): boolean {
  if (!voiceRestartNeeded(previous, next)) {
    return false;
  }
  stt.stop();
  void stt.start().catch(() => undefined);
  return true;
}
