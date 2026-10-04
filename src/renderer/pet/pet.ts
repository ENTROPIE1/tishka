import type { PetModel, PetState } from '../../pet/state';
import { clipForState, type Character } from './character';
import { createCharacter } from './character-factory';
import { createComposer } from './composer';
import { applyPetLayout } from './layout-view';
import { createListenUi } from './listen-ui';
import { createPetCard } from './pet-card';
import { createSpeaker } from './speaker';
import { stateLabel } from './state-label';
import { createWakeListener } from './wake-listener';

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
let interactive = false;
let dragging = false;
let dragMoved = false;
let dragLastX = 0;
let onScreen = false;

const composer = createComposer({
  onSend: (text) => window.tishka.sendUserText(text),
  onEscape: () => {
    if (listen.isListening()) {
      listen.escape();
      return;
    }
    window.tishka.pet.wakeEscape();
  },
  onExpand: () => openComposer()
});
composerHost.append(composer.element);

const speaker = createSpeaker({
  setMouth: (level) => characterModel.setMouth(level),
  onDone: () => window.tishka.pet.speakDone()
});
const petCard = createPetCard({ element: cardHost, refreshBusy });
const listen = createListenUi(() => updateBubble());
createWakeListener({
  onConversation: (on) => {
    listen.setConversation(on);
    composer.setListening(on);
  }
});

function isOnScreen(state: PetState): boolean {
  return state !== 'hidden' && state !== 'leave';
}

function refreshBusy(): void {
  const cardOpen = !cardHost.hidden;
  const typing = !composer.element.hidden && composer.input.value !== '';
  window.tishka.pet.setBusy(cardOpen || typing);
}

function updateBubble(): void {
  const text = say.textContent ?? '';
  bubble.hidden = text === '' && !listen.isListening();
}

function applyComposer(state: PetState, visible: boolean): void {
  composer.element.hidden = !visible;
  if (!visible) {
    return;
  }
  // В состоянии сна и при уведомлении строка свёрнута в полочку.
  composer.setCollapsed(state === 'sleep' || state === 'notify');
  composer.setBusy(state === 'thinking' || state === 'working');
  if (!onScreen) {
    composer.focus();
  }
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
  character.dataset.state = model.state;
  stateLabelEl.textContent = stateLabel(model.state);
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

function isInteractiveAt(x: number, y: number): boolean {
  const element = document.elementFromPoint(x, y);
  if (element === null) {
    return false;
  }
  return (
    character.contains(element) ||
    bubble.contains(element) ||
    cardHost.contains(element) ||
    composer.element.contains(element)
  );
}

function setInteractive(value: boolean): void {
  if (value === interactive) {
    return;
  }
  interactive = value;
  window.tishka.pet.setInteractive(value);
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
    setInteractive(true);
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
    setInteractive(isInteractiveAt(event.clientX, event.clientY));
  });
  window.addEventListener('mouseup', () => {
    if (!dragging) {
      return;
    }
    dragging = false;
    window.tishka.pet.dragEnd();
    if (!dragMoved) {
      openComposer();
    }
  });
}

window.tishka.onPetModel(renderModel);
window.tishka.onEvent((event) => {
  if (event.type === 'speak.level') {
    characterModel.setMouth(event.level);
  } else if (event.type === 'error') {
    listen.setError(event.message);
  }
});
window.tishka.pet.setInteractive(false);
window.tishka.pet.onLayout((layout) => {
  mirrored = layout.mirrored;
  applyPetLayout(pet, layout);
  applyFlip();
});
window.tishka.pet.onSpeak((message) => speaker.play(message));
window.tishka.pet.onSpeakStop(() => speaker.stop());
void characterModel.mount(character).catch(() => undefined);
initCharacter();
initPointer();
