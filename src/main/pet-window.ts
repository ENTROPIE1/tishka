import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import type { Config, EventBus } from '../core/types';
import { PET_LAYOUT_DEFAULTS, petLayout, type PetLayoutContent } from '../pet/layout';
import { initialPet, onEvent, onTick, type PetModel, type TalkSource } from '../pet/state';
import type { ListenCommand } from '../voice/listen';
import type { WakeState } from '../voice/wake';
import type { SpeakMessage } from '../voice/speech-queue';
import { PET_LAYOUT_CHANNEL, PET_LISTEN_COMMAND_CHANNEL, PET_MODEL_CHANNEL, PET_SPEAK_CHANNEL, PET_SPEAK_STOP_CHANNEL, PET_WAKE_STATE_CHANNEL } from './ipc-channels';
import { guardNavigation } from './navigation-guard';
import { Mover, type Geometry } from './pet-motion';

const CONTENT: PetLayoutContent = {};
const TICK_MS = 250;

export interface PetWindowDeps {
  bus: EventBus & { source?(): TalkSource };   // источник текущего обращения: чат или ёж
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

export function createPetWindow(deps: PetWindowDeps): PetWindow {
  const workArea = screen.getPrimaryDisplay().workArea;
  const defaultPetX = workArea.x + workArea.width - PET_LAYOUT_DEFAULTS.margin - PET_LAYOUT_DEFAULTS.petWidth;
  const configuredX = deps.getConfig().pet.x;
  let layout = petLayout(workArea, configuredX ?? defaultPetX, CONTENT);
  const geometry: Geometry = { y: layout.window.y, hiddenX: workArea.x + workArea.width };

  const window = new BrowserWindow({
    width: layout.window.width, height: layout.window.height, x: geometry.hiddenX, y: geometry.y,
    show: false, frame: false, transparent: true, resizable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false
    }
  });
  window.setMenu(null);
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setIgnoreMouseEvents(true, { forward: true });
  guardNavigation(window);

  // Запись с микрофона: разрешаем только доступ к медиа, остальное запрещено.
  window.webContents.session.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === 'media');
  });
  window.webContents.session.setPermissionCheckHandler((_contents, permission) => permission === 'media');
  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (rendererUrl !== undefined) {
    void window.loadURL(`${rendererUrl}/pet/index.html`);
  } else {
    void window.loadFile(join(__dirname, '../renderer/pet/index.html'));
  }

  const mover = new Mover(window, geometry);
  let model: PetModel = initialPet(Date.now());
  let busy = false;
  let focusOnAppear = false;
  let tickTimer: NodeJS.Timeout | undefined;

  function sendModel(): void {
    if (!window.isDestroyed()) window.webContents.send(PET_MODEL_CHANNEL, model);
  }

  function sendLayout(): void {
    if (!window.isDestroyed()) window.webContents.send(PET_LAYOUT_CHANNEL, { mirrored: layout.mirrored });
  }

  function showAtRest(): void {
    window.setPosition(layout.window.x, layout.window.y);
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
        mover.to(layout.window.x);
        break;
      case 'leave':
        mover.to(geometry.hiddenX, () => window.hide());
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
    applyModel(onEvent(model, event, Date.now(), { petMode: petMode(), busy, source: deps.bus.source?.() }));
  }

  const unsubscribe = deps.bus.on(handleEvent);
  tickTimer = setInterval(() => {
    applyModel(onTick(model, Date.now(), { petMode: petMode(), busy }));
  }, TICK_MS);
  window.webContents.on('did-finish-load', () => {
    sendModel();
    sendLayout();
  });

  return {
    wake(source): void {
      // Фокус окна забирают только вызов по клавише и щелчок;
      // при вызове по имени и уведомлении окно остаётся без фокуса.
      focusOnAppear = source === 'hotkey' || source === 'click';
      deps.bus.emit({ type: 'wake', source });
      if (focusOnAppear && !window.isDestroyed() && window.isVisible()) {
        window.focus();
      }
    },
    setInteractive(value): void {
      window.setIgnoreMouseEvents(!value, { forward: true });
    },
    setBusy(value): void {
      busy = value;
    },
    focusWindow(): void {
      if (window.isDestroyed()) return;
      if (!window.isVisible()) showAtRest();
      window.focus();
    },
    dragBy(deltaX): void {
      if (window.isDestroyed()) return;
      // Двигаем ёжика по экрану; окно и сторона раскладки следуют за ним.
      layout = petLayout(workArea, layout.petX + deltaX, CONTENT);
      window.setPosition(layout.window.x, layout.window.y);
      sendLayout();
    },
    dragEnd(): void {
      void deps.savePetX(layout.petX);
    },
    listenCommand(command): void {
      if (!window.isDestroyed()) window.webContents.send(PET_LISTEN_COMMAND_CHANNEL, command);
    },
    wakeState(state): void {
      if (!window.isDestroyed()) window.webContents.send(PET_WAKE_STATE_CHANNEL, state);
    },
    speak(message): void {
      if (!window.isDestroyed()) window.webContents.send(PET_SPEAK_CHANNEL, message);
    },
    stopSpeaking(): void {
      if (!window.isDestroyed()) window.webContents.send(PET_SPEAK_STOP_CHANNEL);
    },
    hide(): void {
      mover.stop();
      if (!window.isDestroyed()) window.hide();
    },
    show(): void {
      if (!window.isDestroyed()) {
        showAtRest();
      }
    },
    leave(): void {
      // Уход по просьбе: анимация ухода, затем окно скрывается, процесс живёт.
      applyModel({ state: 'leave', since: Date.now(), queue: [] });
    },
    reload(): void {
      deps.onReload?.();
      if (!window.isDestroyed()) {
        window.webContents.reload();
      }
    },
    dispose(): void {
      unsubscribe();
      mover.stop();
      if (tickTimer !== undefined) {
        clearInterval(tickTimer);
        tickTimer = undefined;
      }
      if (!window.isDestroyed()) window.destroy();
    }
  };
}
