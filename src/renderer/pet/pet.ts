import type { PetModel, PetState } from '../../pet/state';
import { clipForState, type Character } from './character';
import { createCharacter } from './character-factory';
import { createComposer } from './composer';
import { composerBusy, composerCollapsed } from './composer-state';
import { applyPetLayout } from './layout-view';
import { createListenUi } from './listen-ui';
import { createInteractivity, hitTestRegions } from './interactivity';
import { micThreshold } from '../shared/mic-threshold';
import { createPetCard } from './pet-card';
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
const characterModel: Character = createCharacter('svg');

let mirrored = false;
let currentState: PetState = 'hidden';
let greeting = false;
let waiting = false;
let dragging = false;
let dragMoved = false;
let dragLastX = 0;
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
const interactivity = createInteractivity({
  isVisible: () => onScreen,
  hitTest: (x, y) => hitTestRegions(regions, x, y),
  setInteractive: (value) => window.tishka.pet.setInteractive(value)
});

const speaker = createSpeaker({
  setMouth: (level) => characterModel.setMouth(level),
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
  characterModel.setFlip(moving ? flip : !mirrored);
}

function renderModel(model: PetModel): void {
  currentState = model.state;
  greeting = model.greeting === true;
  character.dataset.state = model.state;
  updateStateLabel();
  say.textContent = listen.say(model.say, model.state);
  petCard.render(model);

  const { clip } = clipForState(model.state);
  characterModel.setClip(clip);
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

function initCharacter(): void {
  character.addEventListener('mousedown', (event) => {
    if (event.button !== 0) {
      return;
    }
    dragging = true;
    dragMoved = false;
    dragLastX = event.screenX;
    wake.beginDrag();
    interactivity.set(true);
    event.preventDefault();
  });
}

function initPointer(): void {
  window.addEventListener('mousemove', (event) => {
    if (dragging) {
      const delta = event.screenX - dragLastX;
      if (Math.abs(delta) > 3) {
        dragMoved = true;
      }
      dragLastX = event.screenX;
      if (delta !== 0) {
        window.tishka.pet.dragBy(delta);
      }
      return;
    }
    interactivity.set(hitTestRegions(regions, event.clientX, event.clientY));
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) {
      return;
    }
    dragging = false;
    window.tishka.pet.dragEnd();
    wake.endDrag();
    if (!dragMoved) {
      openComposer();
    }
  });
}

window.tishka.onPetModel(renderModel);
window.tishka.pet.onCaption((text) => caption.show(text));
window.tishka.onEvent((event) => {
  if (event.type === 'speak.level') {
    characterModel.setMouth(event.level);
  } else if (event.type === 'reply') {
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
});
void refreshScreenLook();
void characterModel.mount(character).catch(() => undefined);
installLinkGuard(document);
initCharacter();
initPointer();
