import type { Config, EventBus } from '../core/types';
import type { ListenCommand } from '../voice/listen';
import type { WakeState } from '../voice/wake';
import type { SpeakMessage } from '../voice/speech-queue';

export interface PetWindowDeps {
  bus: EventBus;
  getConfig: () => Config;
  savePetX: (x: number | null) => Promise<void>;
  onReload?: () => void;
}

export interface PetWindow {
  wake(source: 'name' | 'hotkey' | 'click' | 'trigger'): void;
  setInteractive(interactive: boolean): void;
  setBusy(busy: boolean): void;
  focusWindow(): void;
  dragBy(deltaX: number): void;
  dragEnd(): void;
  listenCommand(command: ListenCommand): void;
  wakeState(state: WakeState): void;
  speak(message: SpeakMessage): void;
  stopSpeaking(): void;
  hide(): void;
  show(): void;
  leave(): void;
  reload(): void;
  dispose(): void;
}
