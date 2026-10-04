import type { TishkaCore } from '../core/app';
import type { EventBus } from '../core/types';
import type { ListenCommand, ListenResult } from '../voice/listen';
import type { SttService } from '../voice/stt-service';

export interface PetListenDeps {
  bus: EventBus;
  core: TishkaCore;
  stt: SttService;
  sendCommand(command: ListenCommand): void;
}

export interface PetListen {
  toggle(source: 'hotkey' | 'click'): void;
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

// Связка записи в окне-питомце с распознаванием и ядром.
export function createPetListen(deps: PetListenDeps): PetListen {
  let listening = false;

  function toggle(source: 'hotkey' | 'click'): void {
    if (listening) {
      deps.sendCommand('stop');
      return;
    }
    if (deps.stt.status() !== 'ready') {
      deps.bus.emit({ type: 'error', message: 'Распознавание речи не настроено' });
      return;
    }
    listening = true;
    deps.bus.emit({ type: 'wake', source });
    deps.bus.emit({ type: 'listen.start' });
    deps.sendCommand('start');
  }

  function handleResult(value: unknown): void {
    const result = parseResult(value);
    if (result === undefined) {
      return;
    }
    listening = false;

    if (result.kind === 'cancel') {
      deps.bus.emit({ type: 'idle' });
      return;
    }
    if (result.kind === 'nospeech') {
      deps.bus.emit({ type: 'error', message: 'Не расслышал' });
      return;
    }
    if (result.kind === 'error') {
      deps.bus.emit({ type: 'error', message: result.message });
      return;
    }

    void deps.stt.transcribe(result.data).then((outcome) => {
      if (!outcome.ok) {
        deps.bus.emit({ type: 'error', message: outcome.error });
        return;
      }
      void deps.core.handleUserText(outcome.text).catch(() => undefined);
    });
  }

  return { toggle, handleResult };
}
