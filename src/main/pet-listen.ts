import type { EventBus } from '../core/types';
import type { ListenCommand, ListenResult } from '../voice/listen';
import type { SttService } from '../voice/stt-service';

export interface PetListenDeps {
  bus: EventBus;
  core: { handleUserText(text: string): Promise<unknown> };
  stt: SttService;
  sendCommand(command: ListenCommand): void;
  onMissedSpeech?(): void;
}

export interface PetListen {
  toggle(source: 'hotkey' | 'click'): void;
  cancel(): void;
  handleResult(value: unknown): void;
}

function parseResult(value: unknown): ListenResult | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  switch (record['kind']) {
    case 'wav': {
      const data = record['data'];
      return data instanceof Uint8Array ? { kind: 'wav', data } : undefined;
    }
    case 'nospeech':
      return { kind: 'nospeech' };
    case 'cancel':
      return { kind: 'cancel' };
    case 'error':
      return {
        kind: 'error',
        message: typeof record['message'] === 'string' ? record['message'] : 'Ошибка записи'
      };
    default:
      return undefined;
  }
}

// Связка разовой записи в окне-питомце с распознаванием и ядром.
export function createPetListen(deps: PetListenDeps): PetListen {
  let recording = false;
  let manual = false;
  // Номер разовой записи: отмена помечает идущее распознавание устаревшим.
  let generation = 0;

  // Разовая запись бывает ручной (значок, клавиша) и запущенной приложением
  // после вызова по имени. Приложение-начатую запись заводит сам вызов
  // (listen.start), а отменяет начало ответа Тишки или отправка текста.
  deps.bus.on((event) => {
    if (event.type === 'listen.start' && !recording) {
      recording = true;
      manual = false;
    } else if ((event.type === 'think.start' || event.type === 'reply') && recording) {
      cancel();
    }
  });

  function toggle(source: 'hotkey' | 'click'): void {
    if (recording) {
      deps.sendCommand('stop');
      return;
    }
    if (deps.stt.status() !== 'ready') {
      deps.bus.emit({ type: 'error', message: 'Распознавание речи не настроено' });
      return;
    }
    recording = true;
    manual = true;
    deps.bus.emit({ type: 'wake', source });
    deps.bus.emit({ type: 'listen.start' });
    deps.sendCommand('start');
  }

  // Отмена идущей разовой записи: молча, без распознавания и сообщений.
  function cancel(): void {
    generation += 1;
    recording = false;
    manual = false;
    deps.sendCommand('cancel');
  }

  function handleResult(value: unknown): void {
    const result = parseResult(value);
    if (result === undefined) {
      return;
    }
    const token = generation;
    const wasManual = recording && manual;
    recording = false;
    manual = false;

    if (result.kind === 'cancel') {
      deps.bus.emit({ type: 'idle' });
      return;
    }
    // Тишина: звука выше порога не было вовсе — человеку не сообщаем.
    if (result.kind === 'nospeech') {
      deps.bus.emit({ type: 'idle' });
      return;
    }
    if (result.kind === 'error') {
      if (wasManual) {
        deps.bus.emit({ type: 'error', message: result.message });
      }
      deps.bus.emit({ type: 'idle' });
      return;
    }

    void deps.stt.transcribe(result.data).then((outcome) => {
      if (token !== generation) {
        return;
      }
      if (!outcome.ok) {
        if (outcome.error === 'Не расслышал') {
          // Звук был, но слов не разобрали: сообщаем только про ручную запись.
          if (wasManual) {
            deps.onMissedSpeech?.();
            deps.bus.emit({ type: 'error', message: 'Не расслышал' });
          }
        } else {
          deps.bus.emit({ type: 'error', message: outcome.error });
        }
        deps.bus.emit({ type: 'idle' });
        return;
      }
      void deps.core.handleUserText(outcome.text).catch(() => undefined);
    });
  }

  return { toggle, cancel, handleResult };
}
