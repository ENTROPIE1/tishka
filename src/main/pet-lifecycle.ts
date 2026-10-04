import type { BrowserWindow } from 'electron';
import type { Config, EventBus } from '../core/types';
import { initialPet, onEvent, onTick, type PetModel } from '../pet/state';
import { PET_LAYOUT_CHANNEL, PET_MODEL_CHANNEL } from './ipc-channels';
import type { Mover } from './pet-motion';
import type { PetPlacement } from './pet-placement';

const TICK_MS = 250;

export interface PetLifecycleDeps {
  window: BrowserWindow;
  mover: Mover;
  placement: PetPlacement;
  bus: EventBus;
  getConfig: () => Config;
}

export interface PetLifecycle {
  sendLayout(): void;
  setBusy(busy: boolean): void;
  leave(): void;
  dispose(): void;
}

// Состояние ёжика: показ, уход, анимация появления и подписка на события.
export function createPetLifecycle(deps: PetLifecycleDeps): PetLifecycle {
  const { window, mover, placement, bus } = deps;
  let model: PetModel = initialPet(Date.now());
  let busy = false;
  let tickTimer: NodeJS.Timeout | undefined;

  function sendModel(): void {
    if (!window.isDestroyed()) window.webContents.send(PET_MODEL_CHANNEL, model);
  }

  function sendLayout(): void {
    if (!window.isDestroyed()) window.webContents.send(PET_LAYOUT_CHANNEL, { mirrored: placement.layout.mirrored });
  }

  function showAtRest(): void {
    placement.ensureOnScreen();
    window.setBounds(placement.bounds());
    window.showInactive();
  }

  function applyState(previous: PetModel, next: PetModel): void {
    if (previous.state === next.state) {
      return;
    }
    switch (next.state) {
      case 'appear':
        // Появление — всегда на сохранённом месте, без пробега через экран:
        // окно встаёт туда, где стоит, и анимацию играет сам персонаж.
        mover.stop();
        placement.ensureOnScreen();
        window.setBounds(placement.bounds());
        window.showInactive();
        break;
      case 'leave':
        // Уход — тоже на месте: окно не двигается, персонаж уходит сам,
        // а окно скрывается при переходе в hidden.
        mover.stop();
        break;
      case 'hidden':
        mover.stop();
        window.hide();
        break;
      default:
        if (!window.isVisible()) showAtRest();
        break;
    }
  }

  function applyModel(next: PetModel): void {
    if (next === model) {
      return;
    }
    const previous = model;
    model = next;
    applyState(previous, next);
    sendModel();
  }

  function petMode(): boolean {
    return deps.getConfig().petMode;
  }

  function handleEvent(event: Parameters<typeof onEvent>[1]): void {
    applyModel(onEvent(model, event, Date.now(), { petMode: petMode(), busy }));
  }

  const unsubscribe = bus.on(handleEvent);
  tickTimer = setInterval(() => {
    applyModel(onTick(model, Date.now(), { petMode: petMode(), busy }));
  }, TICK_MS);
  window.webContents.on('did-finish-load', () => {
    sendModel();
    sendLayout();
  });

  return {
    sendLayout,
    setBusy(value): void {
      busy = value;
    },
    leave(): void {
      // Уход по просьбе: анимация, затем окно скрывается, процесс живёт.
      applyModel({ state: 'leave', since: Date.now(), queue: [] });
    },
    dispose(): void {
      unsubscribe();
      mover.stop();
      if (tickTimer !== undefined) {
        clearInterval(tickTimer);
        tickTimer = undefined;
      }
    }
  };
}
