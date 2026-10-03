import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import type { Config, EventBus } from '../core/types';
import { initialPet, onEvent, onTick, type PetModel } from '../pet/state';
import { PET_MODEL_CHANNEL } from './ipc-channels';
import { Mover, clamp, type Geometry } from './pet-motion';

const WIDTH = 440;
// Высота под колонку: облачко, карточка до 300 и персонаж 200.
const HEIGHT = 660;
const TICK_MS = 250;
const MIN_VISIBLE = 80;

export interface PetWindowDeps {
  bus: EventBus;
  getConfig: () => Config;
  savePetX: (x: number | null) => Promise<void>;
}

export interface PetWindow {
  wake(source: 'name' | 'hotkey' | 'click' | 'trigger'): void;
  setInteractive(interactive: boolean): void;
  setBusy(busy: boolean): void;
  dragBy(deltaX: number): void;
  dragEnd(): void;
  dispose(): void;
}

export function createPetWindow(deps: PetWindowDeps): PetWindow {
  const workArea = screen.getPrimaryDisplay().workArea;
  const geometry: Geometry = {
    y: workArea.y + workArea.height - HEIGHT,
    hiddenX: workArea.x + workArea.width
  };
  const minX = workArea.x - WIDTH + MIN_VISIBLE;
  const maxX = workArea.x + workArea.width - MIN_VISIBLE;
  const configuredX = deps.getConfig().pet.x;
  let restX = clamp(configuredX ?? workArea.x + workArea.width - WIDTH, minX, maxX);

  const window = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    x: geometry.hiddenX,
    y: geometry.y,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  window.setMenu(null);
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setIgnoreMouseEvents(true, { forward: true });

  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (rendererUrl !== undefined) {
    void window.loadURL(`${rendererUrl}/pet/index.html`);
  } else {
    void window.loadFile(join(__dirname, '../renderer/pet/index.html'));
  }

  const mover = new Mover(window, geometry);
  let model: PetModel = initialPet(Date.now());
  let busy = false;
  let tickTimer: NodeJS.Timeout | undefined;

  function sendModel(): void {
    if (!window.isDestroyed()) {
      window.webContents.send(PET_MODEL_CHANNEL, model);
    }
  }

  function showAtRest(): void {
    window.setPosition(restX, geometry.y);
    window.showInactive();
  }

  function applyState(previous: PetModel, next: PetModel): void {
    if (previous.state === next.state) {
      return;
    }
    switch (next.state) {
      case 'appear':
        mover.stop();
        window.setPosition(geometry.hiddenX, geometry.y);
        window.showInactive();
        mover.to(restX);
        break;
      case 'leave':
        mover.to(geometry.hiddenX, () => {
          window.hide();
        });
        break;
      case 'hidden':
        mover.stop();
        window.hide();
        break;
      default:
        if (!window.isVisible()) {
          showAtRest();
        }
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

  const unsubscribe = deps.bus.on(handleEvent);

  tickTimer = setInterval(() => {
    applyModel(onTick(model, Date.now(), { petMode: petMode(), busy }));
  }, TICK_MS);

  window.webContents.on('did-finish-load', sendModel);

  return {
    wake(source): void {
      deps.bus.emit({ type: 'wake', source });
    },
    setInteractive(value): void {
      window.setIgnoreMouseEvents(!value, { forward: true });
    },
    setBusy(value): void {
      busy = value;
    },
    dragBy(deltaX): void {
      if (window.isDestroyed()) {
        return;
      }
      restX = clamp(window.getBounds().x + deltaX, minX, maxX);
      window.setPosition(restX, geometry.y);
    },
    dragEnd(): void {
      void deps.savePetX(restX);
    },
    dispose(): void {
      unsubscribe();
      mover.stop();
      if (tickTimer !== undefined) {
        clearInterval(tickTimer);
        tickTimer = undefined;
      }
      if (!window.isDestroyed()) {
        window.destroy();
      }
    }
  };
}
