import type { PetModel, PetState } from '../../src/pet/state';
import type { ListenCommand } from '../../src/voice/listen';
import type { WakeState } from '../../src/voice/wake';
import type { SpeakMessage } from '../../src/voice/speech-queue';
import type { TishkaEvent } from '../../src/core/types';
import { nextScreenLooking } from '../../src/core/screen-look';
import { bubbleSay } from '../../src/renderer/pet/listen-ui';
import { createStateCaption } from '../../src/renderer/pet/state-caption';
import { createMoodTrack } from '../../src/renderer/pet/mood-track';
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
  sendIsStop(): boolean; // кнопка отправки стала кнопкой остановки
  eyeOn(): boolean;      // кнопка с глазом у ежа активна: Тишка смотрит на экран
  eyeHidden(): boolean;  // кнопка скрыта: просмотр экрана выключен
  speakMoods(): string[];   // эмоции, пришедшие окну вместе со звуком
  speakMouth(): boolean;    // пришла ли дорожка рта
  faceMood(): string | undefined;   // эмоция лица нового персонажа сейчас
  faceMoods(): string[];            // смены эмоции лица по порядку
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
  // Кнопка отправки в строке ежа: занятому Тишке она останавливает работу.
  pressSend(text?: string): void;
  // Escape в строке ежа: пока Тишка занят, останавливает работу.
  pressEscape(): void;
  // Действующая пауза прослушивания: связка страницы с настоящим слушателем.
  listenPaused(): boolean;
}

export interface PageDeps {
  onPhrase(wav: Uint8Array, startedAt: number): void;
  onSpeakDone(id: number | undefined): void;
  onScreenLookSend(text: string): void;
  onScreenLookStop(): void;
  onComposerSend(text: string): void;
  onComposerStop(): void;
  screenLookAvailable(): boolean;
  // Пауза прослушивания изменилась: та же связка, что у слушателя окна ежа.
  onListenPause?(paused: boolean): void;
}

export type PageControl = Page & {
  model(model: PetModel): void;
  wakeState(state: WakeState): void;
  listenCommand(command: ListenCommand): void;
  speak(message: SpeakMessage): void;
  stopSpeak(): void;
  setVisible(value: boolean): void;
  event(event: TishkaEvent): void;
  // Разовая подпись под ежом (например, «не разобрал»).
  caption(text: string): void;
  listenPaused(): boolean;
};

// Страница окна-питомца: то, что человек видит. Настоящие правила облачка,
// подписи состояния и пауз записаны в продукте; здесь только их связка.
export function createPage(deps: PageDeps): PageControl {
  const pause: ListenPause = createListenPause((value) => deps.onListenPause?.(value));
  const stateCaption = createStateCaption(() => undefined);
  let model: PetModel = { state: 'hidden', since: 0, queue: [] };
  let wake: WakeState | undefined;
  let listening = false;
  let error = '';
  let listenerActive = false;
  let interactive = false;
  let visible = false;
  let eyeLooking = false;
  let speechTimer: ReturnType<typeof setTimeout> | undefined;
  let speakMoods: string[] = [];
  let speakMouth = false;
  let faceMood: string | undefined;
  const faceMoods: string[] = [];
  // Та же связка эмоции лица, что в окне ежа: настроение ответа, метки речи,
  // сброс в покое и при уходе.
  const mood = createMoodTrack({
    setMood: (name) => {
      faceMood = name;
      faceMoods.push(name);
    }
  });

  function onScreen(state: PetState): boolean {
    return state !== 'hidden' && state !== 'leave';
  }

  const observations: PageObservations = {
    state: () => model.state,
    label: () => stateCaption.current() ?? stateLabel(model.state, wake?.waiting === true, model.greeting === true),
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
    sendIsStop: () => composerBusy(model.state),
    eyeOn: () => eyeLooking,
    eyeHidden: () => !deps.screenLookAvailable(),
    speakMoods: () => speakMoods,
    speakMouth: () => speakMouth,
    faceMood: () => faceMood,
    faceMoods: () => faceMoods
  };

  return {
    observations,
    model(next: PetModel): void {
      model = next;
      mood.state(next.state);
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
      speakMoods = message.moods?.map((mark) => mark.mood) ?? [];
      speakMouth = message.mouth !== undefined;
      mood.reply(message.mood);
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
    // Фраза несёт время начала — момент, когда человек начал говорить.
    say(): boolean {
      if (!listenerActive || pause.isPaused()) {
        return false;
      }
      deps.onPhrase(PHRASE_WAV, Date.now());
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
      if (next.type === 'reply') {
        mood.reply(next.reply.mood);
      }
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
    },
    // Кнопка отправки строки: пока Тишка занят, нажатие останавливает работу,
    // иначе отправляет набранный текст.
    pressSend(text = ''): void {
      if (composerBusy(model.state)) {
        deps.onComposerStop();
        return;
      }
      if (text !== '') {
        deps.onComposerSend(text);
      }
    },
    // Escape в строке ежа: пока Тишка занят, останавливает работу.
    pressEscape(): void {
      if (composerBusy(model.state)) {
        deps.onComposerStop();
      }
    },
    caption(text: string): void {
      stateCaption.show(text);
    },
    listenPaused: () => pause.isPaused()
  };
}
