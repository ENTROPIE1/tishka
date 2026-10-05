import type { PetModel, PetState } from '../../src/pet/state';
import type { ListenCommand } from '../../src/voice/listen';
import type { WakeState } from '../../src/voice/wake';
import type { SpeakMessage } from '../../src/voice/speech-queue';
import type { TishkaEvent } from '../../src/core/types';
import { nextScreenLooking } from '../../src/core/screen-look';
import { bubbleSay } from '../../src/renderer/pet/listen-ui';
import { stateLabel } from '../../src/renderer/pet/state-label';
import { composerBusy, composerCollapsed } from '../../src/renderer/pet/composer-state';
import { screenLookAction, type ScreenLookAction } from '../../src/renderer/shared/screen-look-request';
import {
  createListenPause,
  DRAG_RESUME_MS,
  TYPING_RESUME_MS,
  type ListenPause
} from '../../src/renderer/shared/listen-pause';

const PHRASE_WAV = new Uint8Array([1, 2, 3, 4]);
const SPEECH_MS = 300;

export interface PageObservations {
  state(): PetState;
  label(): string;
  bubble(): string;
  modelSay(): string | undefined;
  card(): boolean;
  micOn(): boolean;
  micWaiting(): boolean;
  soon(): boolean;
  recording(): boolean;
  listening(): boolean;
  interactive(): boolean;
  composerVisible(): boolean;
  composerCollapsed(): boolean;
  eyeOn(): boolean;      // кнопка с глазом активна: Тишка смотрит на экран
  eyeHidden(): boolean;  // кнопка скрыта: просмотр экрана выключен
}

export interface Page {
  observations: PageObservations;
  say(): boolean;
  typeKey(): void;
  press(): void;
  release(): void;
  focusComposer(): void;
  pointer(): void;
  setError(message: string): void;
  pressEye(question?: string): ScreenLookAction;
}

export interface PageDeps {
  onPhrase(wav: Uint8Array): void;
  onSpeakDone(id: number | undefined): void;
  onScreenLookSend(text: string): void;
  onScreenLookStop(): void;
  screenLookAvailable(): boolean;
}

export type PageControl = Page & {
  model(model: PetModel): void;
  wakeState(state: WakeState): void;
  listenCommand(command: ListenCommand): void;
  speak(message: SpeakMessage): void;
  stopSpeak(): void;
  setVisible(value: boolean): void;
  event(event: TishkaEvent): void;
};

// Страница окна-питомца: то, что человек видит. Настоящие правила облачка,
// подписи состояния и пауз записаны в продукте; здесь только их связка.
export function createPage(deps: PageDeps): PageControl {
  const pause: ListenPause = createListenPause(() => undefined);
  let model: PetModel = { state: 'hidden', since: 0, queue: [] };
  let wake: WakeState | undefined;
  let listening = false;
  let error = '';
  let listenerActive = false;
  let interactive = false;
  let visible = false;
  let eyeLooking = false;
  let speechTimer: ReturnType<typeof setTimeout> | undefined;

  function onScreen(state: PetState): boolean {
    return state !== 'hidden' && state !== 'leave';
  }

  const observations: PageObservations = {
    state: () => model.state,
    label: () => stateLabel(model.state, wake?.waiting === true, model.greeting === true),
    bubble: () =>
      bubbleSay({
        modelSay: model.say,
        state: model.state,
        error
      }),
    modelSay: () => model.say,
    card: () => model.panel !== undefined || model.ask !== undefined,
    micOn: () => wake?.conversation === true,
    micWaiting: () => wake?.waiting === true,
    soon: () => wake?.soon === true,
    recording: () => listenerActive && !pause.isPaused(),
    listening: () => listening,
    interactive: () => interactive,
    composerVisible: () => onScreen(model.state),
    composerCollapsed: () => composerCollapsed(model.state),
    eyeOn: () => eyeLooking,
    eyeHidden: () => !deps.screenLookAvailable()
  };

  return {
    observations,
    model(next: PetModel): void {
      model = next;
    },
    wakeState(state: WakeState): void {
      wake = state;
      if (state.active && !listenerActive) {
        listenerActive = true;
      }
      if (!state.active && listenerActive) {
        listenerActive = false;
      }
    },
    listenCommand(command: ListenCommand): void {
      listening = command === 'start';
    },
    speak(message: SpeakMessage): void {
      if (speechTimer !== undefined) {
        clearTimeout(speechTimer);
      }
      speechTimer = setTimeout(() => {
        speechTimer = undefined;
        deps.onSpeakDone(message.id);
      }, SPEECH_MS);
    },
    stopSpeak(): void {
      if (speechTimer !== undefined) {
        clearTimeout(speechTimer);
        speechTimer = undefined;
      }
    },
    setVisible(value: boolean): void {
      visible = value;
      if (!value) {
        interactive = false;
      }
    },
    focusComposer(): void {
      if (onScreen(model.state)) {
        interactive = true;
      }
    },
    pointer(): void {
      interactive = visible && onScreen(model.state);
    },
    setError(message: string): void {
      error = message;
    },
    // Человек произнёс фразу: уходит на распознавание, только если микрофон
    // пишет и не на паузе (паузу держат печать и удержание ежа мышью).
    say(): boolean {
      if (!listenerActive || pause.isPaused()) {
        return false;
      }
      deps.onPhrase(PHRASE_WAV);
      return true;
    },
    typeKey(): void {
      pause.hold('typing', TYPING_RESUME_MS);
    },
    press(): void {
      pause.hold('drag');
    },
    release(): void {
      pause.hold('drag', DRAG_RESUME_MS);
    },
    // События ядра доходят до окна, как broadcastEvent: по ним окно ведёт
    // кнопку с глазом — то же правило, что в preload окна ежа.
    event(next: TishkaEvent): void {
      eyeLooking = nextScreenLooking(eyeLooking, next);
    },
    // Нажатие кнопки с глазом: то же решение, что в строке ввода ежа.
    pressEye(question = ''): ScreenLookAction {
      const action = screenLookAction({
        looking: eyeLooking,
        busy: composerBusy(model.state),
        available: deps.screenLookAvailable(),
        question
      });
      if (action.kind === 'send') {
        deps.onScreenLookSend(action.text);
      } else if (action.kind === 'stop') {
        deps.onScreenLookStop();
      }
      return action;
    }
  };
}
