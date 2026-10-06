import type { PetModel, PetState } from '../../pet/state';
import { clipForState, type Character } from './character';
import { loadCharacter } from './character-factory';
import { createComposer } from './composer';
import { composerBusy, composerCollapsed } from './composer-state';
import { createDrag } from './drag';
import { applyPetLayout } from './layout-view';
import { createListenUi } from './listen-ui';
import { canvasPixelOpaque, createInteractivity, hitTestRegions, isInteractiveTarget } from './interactivity';
import { micThreshold } from '../shared/mic-threshold';
import { createPetCard } from './pet-card';
import { createMoodTrack } from './mood-track';
import { createSpeaker } from './speaker';
import { createStateCaption } from './state-caption';
import { stateLabel } from './state-label';
import { createWakeListener } from './wake-listener';
import { installLinkGuard } from '../shared/links';
import { timingMark } from '../shared/timing';

const pet = document.getElementById('pet') as HTMLElement;
const bubble = document.getElementById('bubble') as HTMLElement;
const say = document.getElementById('say') as HTMLElement;
const cardHost = document.getElementById('card-host') as HTMLElement;
const character = document.getElementById('character') as HTMLElement;
const stateLabelEl = document.getElementById('state-label') as HTMLElement;
const composerHost = document.getElementById('composer-host') as HTMLElement;
let characterModel: Character | undefined;
let characterKind = 'hedgehog';
let mouthLevel: number | null = null;

let mirrored = false;
let currentState: PetState = 'hidden';
let greeting = false;
let waiting = false;
let dragging = false;
let onScreen = false;

const composer = createComposer({
  onSend: (text) => window.tishka.sendUserText(text),
  // Пока Тишка занят, кнопка отправки и Escape останавливают работу общим каналом.
  onStop: () => window.tishka.stop(),
  onEscape: () => {
    if (listen.isListening()) {
      listen.escape();
      return;
    }
    window.tishka.pet.wakeEscape();
  },
  onExpand: () => openComposer(),
  onFocus: () => window.tishka.pet.focus(),
  onSettings: () => {
    void window.tishka.openSettings();
  },
  // Глаз: просьба посмотреть на экран уходит тем же текстом, что из чата,
  // остановка — общим каналом остановки.
  onScreenLook: (action) => {
    if (action.kind === 'send') {
      window.tishka.sendUserText(action.text);
    } else if (action.kind === 'stop') {
      window.tishka.stop();
    }
  }
});
composerHost.append(composer.element);

const regions = [character, bubble, cardHost, composer.element];
// Широкий холст нового персонажа не ловит мышь сам: попадание считаем по его
// непрозрачному пикселю, иначе щелчок уходит ниже — к строке ввода.
const rigCanvas = (): HTMLCanvasElement | null => character.querySelector('canvas');
const hitTest = (x: number, y: number): boolean =>
  hitTestRegions(regions, x, y, { canvas: rigCanvas(), opaque: canvasPixelOpaque });
const interactivity = createInteractivity({
  isVisible: () => onScreen,
  hitTest,
  setInteractive: (value) => window.tishka.pet.setInteractive(value)
});

// Эмоция лица нового персонажа: настроение ответа, метки посреди речи,
// сброс в покое и при уходе. Прежний ёж setMood не реализует.
const faceMood = createMoodTrack({ setMood: (name) => characterModel?.setMood?.(name) });

const speaker = createSpeaker({
  setMouth: (level) => {
    mouthLevel = level;
    characterModel?.setMouth(level);
  },
  // Новый персонаж ведёт рот по дорожке речи и меняет эмоцию по времени звука.
  setViseme: (shape) => characterModel?.setViseme?.(shape),
  setMood: (name) => faceMood.mark(name),
  onDone: (id) => window.tishka.pet.speakDone(id)
});
const petCard = createPetCard({ element: cardHost, refreshBusy });
const wake = createWakeListener({
  onConversation: (on) => {
    composer.setListening(on);
  },
  onWaiting: (value) => {
    waiting = value;
    composer.setWaiting(value);
    updateStateLabel();
  }
});
const listen = createListenUi((value) => wake.setRecorderListening(value), micThreshold);
composer.input.addEventListener('keydown', () => {
  wake.keyboard();
  // Печать отменяет идущую разовую запись: её пустой итог не должен
  // показаться сообщением «Не расслышал».
  listen.cancel();
});

function isOnScreen(state: PetState): boolean {
  return state !== 'hidden' && state !== 'leave';
}

function refreshBusy(): void {
  const cardOpen = !cardHost.hidden;
  const typing = !composer.element.hidden && composer.input.value !== '';
  window.tishka.pet.setBusy(cardOpen || typing);
}

// Облачко видно, только когда есть слова: пустой текст прячет его.
function updateBubble(): void {
  const text = say.textContent ?? '';
  bubble.hidden = text === '';
}

function updateStateLabel(): void {
  // Разовая подпись («не разобрал») главнее подписи состояния.
  stateLabelEl.textContent = caption.current() ?? stateLabel(currentState, waiting, greeting);
}

const caption = createStateCaption(updateStateLabel);

function applyComposer(state: PetState, visible: boolean): void {
  composer.element.hidden = !visible;
  if (!visible) {
    return;
  }
  // В состоянии сна и при уведомлении строка свёрнута в полочку.
  composer.setCollapsed(composerCollapsed(state));
  composer.setBusy(composerBusy(state));
}

// Ёжик смотрит на колонку ответов: в обычной раскладке — влево, в зеркальной —
// вправо. Во время появления и ухода направление движения прежнее.
function applyFlip(): void {
  const { flip } = clipForState(currentState);
  const moving = currentState === 'appear' || currentState === 'leave';
  characterModel?.setFlip(moving ? flip : !mirrored);
}

function renderModel(model: PetModel): void {
  currentState = model.state;
  greeting = model.greeting === true;
  character.dataset.state = model.state;
  updateStateLabel();
  say.textContent = listen.say(model.say, model.state);
  petCard.render(model);

  const { clip } = clipForState(model.state);
  characterModel?.setClip(clip);
  faceMood.state(model.state);
  applyFlip();

  const visible = isOnScreen(model.state);
  applyComposer(model.state, visible);
  onScreen = visible;

  updateBubble();
  refreshBusy();
}

function openComposer(): void {
  window.tishka.pet.wake('click');
  window.tishka.pet.focus();
  composer.element.hidden = false;
  composer.setCollapsed(false);
  composer.clear();
  updateBubble();
  refreshBusy();
  composer.focus();
}

async function requestedCharacter(): Promise<string> {
  try {
    const view = await window.tishka.config.get();
    return view.config.persona.character;
  } catch {
    return 'hedgehog';
  }
}

// Пересозданному персонажу возвращаем текущее состояние, отражение и рот.
function applyCurrentCharacter(): void {
  characterModel?.setClip(clipForState(currentState).clip);
  faceMood.apply();
  applyFlip();
  if (mouthLevel !== null) {
    characterModel?.setMouth(mouthLevel);
  }
}

async function mountCharacter(kind: string): Promise<void> {
  characterModel?.dispose();
  character.replaceChildren();
  characterModel = undefined;
  characterModel = await loadCharacter(kind, character, (message) => {
    window.tishka.timingMark('character.fallback', { message });
  });
  // У костного персонажа широкий прозрачный холст: он не должен перехватывать
  // щелчки, попадание считается по пикселю (см. hitTest).
  character.classList.toggle('rig', character.querySelector('canvas') !== null);
  applyCurrentCharacter();
}

// Настройка «persona.character» применяется сразу: окно ежа пересоздаёт персонажа.
async function refreshCharacter(): Promise<void> {
  const kind = await requestedCharacter();
  if (kind === characterKind && characterModel !== undefined) {
    return;
  }
  characterKind = kind;
  await mountCharacter(kind);
}

// Перетаскивание начинается по щелчку на самом персонаже. У костного персонажа
// холст прозрачный по краям, поэтому обычный слушатель на элементе не годится:
// точка проверяется по непрозрачности пикселя.
function onCharacterPointerDown(event: PointerEvent): void {
  if (event.button !== 0 || dragging) {
    return;
  }
  if (isInteractiveTarget(event.target)) {
    return;
  }
  const canvas = rigCanvas();
  if (canvas !== null) {
    if (!canvasPixelOpaque(canvas, event.clientX, event.clientY)) {
      return;
    }
  } else if (!(event.target instanceof Node) || !character.contains(event.target)) {
    return;
  }
  drag.down(event.screenX, event.button);
  event.preventDefault();
}

function initCharacter(): void {
  window.addEventListener('pointerdown', onCharacterPointerDown);
}

// Перетаскивание ежа: указатель нажимают на персонаже, отпускают в любом месте
// окна или вне его. Конец ловим по отпусканию, отмене указателя, потере фокуса
// и таймауту без движения — окно не остаётся прилипшим к курсору.
const drag = createDrag({
  onBegin: () => {
    dragging = true;
    wake.beginDrag();
    interactivity.set(true);
  },
  onMove: (delta) => {
    window.tishka.pet.dragBy(delta);
    wake.dragMove();
  },
  onEnd: () => {
    dragging = false;
    window.tishka.pet.dragEnd();
    wake.endDrag();
  },
  onClick: () => openComposer()
});

function initPointer(): void {
  window.addEventListener('pointermove', (event) => {
    if (dragging) {
      drag.move(event.screenX);
      return;
    }
    interactivity.set(hitTest(event.clientX, event.clientY));
  });
  window.addEventListener('pointerup', () => drag.up());
  window.addEventListener('pointercancel', () => drag.cancel());
  window.addEventListener('blur', () => drag.cancel());
}

window.tishka.onPetModel(renderModel);
window.tishka.pet.onCaption((text) => caption.show(text));
window.tishka.onEvent((event) => {
  if (event.type === 'speak.level') {
    mouthLevel = event.level;
    characterModel?.setMouth(event.level);
  } else if (event.type === 'reply') {
    faceMood.reply(event.reply.mood);
    timingMark('reply.shown');
  } else if (event.type === 'error') {
    listen.setError(event.message);
  } else if (event.type === 'wake' || event.type === 'idle' || event.type === 'speak.end') {
    // Появление ежа и конец ответа (в том числе речи) — граница записи:
    // сказанное до неё репликой не становится.
    wake.reset();
  }
});
window.tishka.pet.setInteractive(false);
window.tishka.pet.onPointer((point) => interactivity.recalc(point));
window.tishka.pet.onFocusInput(() => {
  if (!composer.element.hidden) {
    composer.focus();
  }
});
window.tishka.pet.onLayout((layout) => {
  mirrored = layout.mirrored;
  applyPetLayout(pet, layout);
  applyFlip();
});
window.tishka.pet.onSpeak((message) => speaker.play(message));
window.tishka.pet.onSpeakStop(() => speaker.stop());
// Вид кнопки с глазом ведёт ядро: событие о просмотре экрана приходит обоим окнам.
window.tishka.onScreenLook((looking) => {
  composer.setLooking(looking);
});
// Просмотр экрана выключен в настройках: кнопки с глазом нет.
async function refreshScreenLook(): Promise<void> {
  try {
    const view = await window.tishka.config.get();
    composer.setScreenLookAvailable(view.config.screen.enabled);
  } catch {
    composer.setScreenLookAvailable(false);
  }
}
window.tishka.config.onChanged(() => {
  void refreshScreenLook();
  void refreshCharacter();
});
void refreshScreenLook();
void refreshCharacter();
installLinkGuard(document);
initCharacter();
initPointer();
