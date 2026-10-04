import type { BrowserWindow } from 'electron';
import type { Config, EventBus } from '../core/types';
import { initialPet, onEvent, onTick, type PetModel } from '../pet/state';
import { PET_LAYOUT_CHANNEL, PET_MODEL_CHANNEL } from './ipc-channels';
import type { PetActivation } from './pet-activation';
import type { Mover } from './pet-motion';
import type { PetPlacement } from './pet-placement';

const TICK_MS = 250;

export interface PetLifecycleDeps {
  window: BrowserWindow;
  mover: Mover;
  placement: PetPlacement;
  activation: PetActivation;
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
  const { window, mover, placement, activation, bus } = deps;
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
    activation.sendPointer();
  }

  function applyState(previous: PetModel, next: PetModel): void {
    if (previous.state === next.state) {
      return;
    }
    switch (next.state) {
      case 'appear':
        mover.stop();
        window.setBounds(placement.hiddenBounds());
        window.showInactive();
        // Когда окно встало на место, считаем интерактивность по курсору.
        mover.to(placement.layout.window.x, () => activation.sendPointer());
        break;
      case 'leave':
        mover.to(placement.geometry.hiddenX, () => window.hide());
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
    // Перезагрузка окна: курсор мог уже стоять над строкой ввода.
    activation.sendPointer();
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
